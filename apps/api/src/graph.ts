import { FalkorDB } from 'falkordb'
import type { Snapshot } from '../../../shared/contracts.js'
import { seedSnapshot } from './seed.js'
import { tailorDemoContext } from './demo-context.js'

export interface Store { read(): Promise<Snapshot>; write(state: Snapshot): Promise<void>; close(): Promise<void> }

// A single-company MVP snapshot lives in FalkorDB. Entity nodes and relationships
// are updated in the same graph query, so there is no second store or sync worker.
export class GraphStore implements Store {
  private db: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null
  private connecting: Promise<void> | null = null
  constructor(private readonly options = { host: process.env.FALKORDB_HOST || '127.0.0.1', port: Number(process.env.FALKORDB_PORT || 16379), graph: process.env.FALKORDB_GRAPH || 'company_brain', password: process.env.FALKORDB_PASSWORD }) {}
  private async connect() {
    if (this.db) return
    if (!this.connecting) this.connecting = (async () => {
      // FalkorDB forwards these options to node-redis; its public types omit them.
      const connectionOptions = { socket: { host: this.options.host, port: this.options.port, connectTimeout: 1500, reconnectStrategy: false }, disableOfflineQueue: true, password: this.options.password }
      const db = await FalkorDB.connect(connectionOptions)
      db.on('error', () => { if (this.db === db) this.db = null })
      this.db = db
    })().finally(() => { this.connecting = null })
    await this.connecting
  }
  async read(): Promise<Snapshot> {
    await this.connect()
    try {
      const result = await this.db!.selectGraph(this.options.graph).query<{ payload: string }>('MATCH (s:CompanyState {id: $id}) RETURN s.payload AS payload', { params: { id: 'demo' } })
      const row = result.data?.[0]
      if (row) {
        const state = JSON.parse(row.payload) as Snapshot
        if (tailorDemoContext(state)) await this.write(state)
        return state
      }
    } catch (error) {
      // A missing graph is initialized on the first write. Other failures propagate.
      if (!(error instanceof Error) || !/empty key|does not exist|nonexistent|key is empty/i.test(error.message)) throw error
    }
    const initial = seedSnapshot()
    await this.write(initial)
    return initial
  }
  async write(state: Snapshot) {
    await this.connect()
    const nodes = [
      ...state.employees.map(e => ({ id: e.id, kind: 'Employee', data: JSON.stringify(e) })),
      ...state.tasks.map(t => ({ id: t.id, kind: 'Task', data: JSON.stringify(t) })),
      ...state.updates.map(u => ({ id: u.id, kind: 'Update', data: JSON.stringify(u) })),
      ...state.messages.map(m => ({ id: m.id, kind: 'Message', data: JSON.stringify(m) })),
      ...state.chats.map(c => ({ id: `chat-${c.id}`, kind: 'FounderChat', data: JSON.stringify(c) })),
    ]
    const edges = [
      ...state.tasks.filter(t => t.ownerId).map(t => ({ from: t.ownerId!, to: t.id, kind: 'OWNS' })),
      ...state.updates.map(u => ({ from: u.id, to: u.taskId, kind: 'UPDATES' })),
      ...state.updates.filter(u => u.employeeId).map(u => ({ from: u.employeeId!, to: u.id, kind: 'AUTHORED' })),
      ...state.messages.map(m => ({ from: m.id, to: m.taskId, kind: 'ABOUT' })),
    ]
    await this.db!.selectGraph(this.options.graph).query(`
      MERGE (s:CompanyState {id: $id}) SET s.payload = $payload
      WITH s UNWIND $nodes AS row
      MERGE (n:Entity {id: row.id}) SET n.kind = row.kind, n.data = row.data
      WITH DISTINCT s OPTIONAL MATCH (:Entity)-[r:RELATES]->(:Entity) DELETE r
      WITH DISTINCT s UNWIND $edges AS edge
      MATCH (a:Entity {id: edge.from}), (b:Entity {id: edge.to})
      MERGE (a)-[:RELATES {kind: edge.kind}]->(b)
    `, { params: { id: 'demo', payload: JSON.stringify(state), nodes, edges } })
  }
  async close() { const db = this.db; this.db = null; if (db) await db.close() }
}
