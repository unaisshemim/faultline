import { FalkorDB } from 'falkordb'
import { dependencyEdges, serviceNames, type ChangeRecord, type QueryRecord, type ServiceName, type TraceSpan } from '../../../../shared/incident.js'

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue }

export interface IncidentGraph {
  initialize(): Promise<void>
  save(runId: string, spans: TraceSpan[], changes: ChangeRecord[]): Promise<void>
  paths(root: ServiceName): Promise<ServiceName[][]>
  traces(runId: string): Promise<TraceSpan[]>
  changes(runId: string): Promise<ChangeRecord[]>
  convergence(root: ServiceName, branches: ServiceName[]): Promise<{ service: ServiceName; branches: ServiceName[] }[]>
  drainQueries(): QueryRecord[]
  close(): Promise<void>
}
export class FalkorIncidentGraph implements IncidentGraph {
  private db: Awaited<ReturnType<typeof FalkorDB.connect>> | null = null
  private connecting: Promise<void> | null = null
  private queries: QueryRecord[] = []
  constructor(readonly graphName = 'company_brain_incidents', private options = { host: process.env.FALKORDB_HOST || '127.0.0.1', port: Number(process.env.FALKORDB_PORT || 16379), password: process.env.FALKORDB_PASSWORD }) {}
  private async connect() {
    if (this.db) return
    if (!this.connecting) this.connecting = (async () => {
      const connectionOptions = { socket: { host: this.options.host, port: this.options.port, connectTimeout: 1500, reconnectStrategy: false }, password: this.options.password }
      this.db = await FalkorDB.connect(connectionOptions)
      this.db.on('error', () => { this.db = null })
    })().finally(() => { this.connecting = null })
    await this.connecting
  }
  private async query<T extends Record<string, unknown>>(tool: string, cypher: string, parameters: Record<string, unknown>, record = true) {
    await this.connect()
    const start = performance.now()
    const result = await this.db!.selectGraph(this.graphName).query<T>(cypher, { params: parameters as Record<string, JsonValue> })
    if (record) this.queries.push({ tool, cypher, parameters, rowCount: result.data?.length ?? 0, durationMs: Math.round(performance.now() - start) })
    return result.data ?? []
  }
  async initialize() {
    await this.query('initialize', 'UNWIND $services AS name MERGE (:IncidentService {name: name})', { services: [...serviceNames] }, false)
    await this.query('initialize', 'UNWIND $edges AS edge MATCH (a:IncidentService {name: edge.source}), (b:IncidentService {name: edge.target}) MERGE (a)-[:DEPENDS_ON]->(b)', { edges: dependencyEdges.map(([source, target]) => ({ source, target })) }, false)
  }
  async save(runId: string, spans: TraceSpan[], changes: ChangeRecord[]) {
    await this.query('persist_evidence', `MERGE (run:IncidentRun {id: $runId})
WITH run UNWIND $spans AS item
MERGE (span:IncidentSpan {id: item.id}) SET span += item
MERGE (run)-[:HAS_SPAN]->(span)
WITH DISTINCT run, span MATCH (service:IncidentService {name: span.service}) MERGE (span)-[:ON_SERVICE]->(service)`, { runId, spans }, false)
    if (changes.length) await this.query('persist_changes', `MATCH (run:IncidentRun {id: $runId}) UNWIND $changes AS item
MERGE (change:IncidentChange {id: item.id}) SET change += item
MERGE (run)-[:HAS_CHANGE]->(change)
WITH change MATCH (service:IncidentService {name: change.service}) MERGE (change)-[:CHANGED]->(service)`, { runId, changes }, false)
  }
  async paths(root: ServiceName) {
    const rows = await this.query<{ services: ServiceName[] }>('trace_dependencies', 'MATCH path=(root:IncidentService {name: $root})-[:DEPENDS_ON*1..4]->(dependency:IncidentService) RETURN [service IN nodes(path) | service.name] AS services, length(path) AS hops ORDER BY hops', { root })
    return rows.map(row => row.services)
  }
  async traces(runId: string) {
    const rows = await this.query<{ span: TraceSpan }>('read_trace_evidence', 'MATCH (run:IncidentRun {id: $runId})-[:HAS_SPAN]->(span:IncidentSpan) WHERE span.phase = $phase RETURN properties(span) AS span ORDER BY span.startedAt, span.id', { runId, phase: 'incident' })
    return rows.map(row => row.span)
  }
  async changes(runId: string) {
    const rows = await this.query<{ change: ChangeRecord }>('read_recent_changes', 'MATCH (run:IncidentRun {id: $runId})-[:HAS_CHANGE]->(change:IncidentChange) WHERE change.kind <> $rollback RETURN properties(change) AS change ORDER BY change.at', { runId, rollback: 'rollback' })
    return rows.map(row => row.change)
  }
  async convergence(root: ServiceName, branches: ServiceName[]) {
    return this.query<{ service: ServiceName; branches: ServiceName[] }>('find_convergence', `MATCH (root:IncidentService {name: $root})-[:DEPENDS_ON]->(branch:IncidentService)-[:DEPENDS_ON*1..3]->(dependency:IncidentService)
WHERE branch.name IN $branches
WITH dependency, collect(DISTINCT branch.name) AS branches WHERE size(branches) > 1
RETURN dependency.name AS service, branches`, { root, branches })
  }
  drainQueries() { const result = this.queries; this.queries = []; return result }
  async close() { const db = this.db; this.db = null; if (db) await db.close() }
}
