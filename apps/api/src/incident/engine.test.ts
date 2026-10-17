import { expect, it } from 'vitest'
import { dependencyEdges, type ChangeRecord, type ServiceName, type TraceSpan, type QueryRecord } from '../../../../shared/incident.js'
import type { IncidentGraph } from './graph.js'
import { createIncidentRoutes } from './routes.js'

export class MemoryIncidentGraph implements IncidentGraph {
  spans: TraceSpan[] = []; events: ChangeRecord[] = []; queryLog: QueryRecord[] = []
  async initialize() {}
  async save(_id: string, spans: TraceSpan[], changes: ChangeRecord[]) { this.spans = structuredClone(spans); this.events = structuredClone(changes) }
  async paths(root: ServiceName) {
    const paths: ServiceName[][] = []
    const walk = (path: ServiceName[]) => { for (const [source, target] of dependencyEdges) if (source === path.at(-1)) { const next = [...path, target]; paths.push(next); walk(next) } }
    walk([root]); return paths
  }
  async traces() { return this.spans.filter(span => span.phase === 'incident') }
  async changes() { return this.events.filter(change => change.kind !== 'rollback') }
  async convergence(root: ServiceName, branches: ServiceName[]) {
    const paths = await this.paths(root), shared = new Map<ServiceName, Set<ServiceName>>()
    for (const path of paths.filter(path => path.length > 2 && branches.includes(path[1]))) {
      const names = shared.get(path.at(-1)!) ?? new Set<ServiceName>(); names.add(path[1]); shared.set(path.at(-1)!, names)
    }
    return [...shared].filter(([, branches]) => branches.size > 1).map(([service, branches]) => ({ service, branches: [...branches] }))
  }
  drainQueries() { const rows = this.queryLog; this.queryLog = []; return rows }
  async close() {}
}
export function fixture(graph: IncidentGraph = new MemoryIncidentGraph()) {
  const routes = createIncidentRoutes(graph, { model: 'test-model' })
  const post = (path: string, body = {}) => routes.app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { ...routes, post }
}
it('executes real timeout failures, investigates shared paths, and recovers only after approved rollback', async () => {
  const { app, post } = fixture()
  const started = await post('/start', { fault: 'product-data' }); expect(started.status).toBe(200)
  const snapshot = await started.json(), run = snapshot.run
  expect(snapshot.simulated).toBe(true)
  expect(run.alerts).toHaveLength(5)
  expect(run.before.ok).toBe(false)
  expect(run.spans.some((span: TraceSpan) => span.service === 'product-data' && span.errorCode === 'TIMEOUT' && span.durationMs >= 25)).toBe(true)
  expect(run.spans.find((span: TraceSpan) => span.service === 'payments').ok).toBe(true)
  expect((await app.request('/services/checkout?sku=DEMO-001&quantity=1')).status).toBe(503)
  const investigated = await (await post('/investigate', { runId: run.id, engine: 'deterministic' })).json()
  expect(investigated.run.diagnosis.rootCause).toBe('product-data')
  expect(investigated.run.diagnosis.paths).toHaveLength(2)
  expect(investigated.run.diagnosis.eliminated[0].service).toBe('payments')
  expect((await post('/rollback', { runId: run.id, approvalId: '00000000-0000-4000-8000-000000000001' })).status).toBe(409)
  const approved = { runId: run.id, approvalId: investigated.run.approval.id }
  const fixed = await (await post('/rollback', approved)).json()
  expect(fixed.run.state).toBe('recovered')
  expect(fixed.run.verification.ok).toBe(true)
  expect(fixed.run.before.request).toBe(fixed.run.verification.request)
  expect(fixed.services.every((service: { status: string }) => service.status === 'healthy')).toBe(true)
  expect((await (await post('/rollback', approved)).json()).run.spans).toHaveLength(fixed.run.spans.length)
})
it('moves the fault to payments without changing topology and reaches a different evidence-backed diagnosis', async () => {
  const { post } = fixture()
  const first = await (await post('/start', { fault: 'product-data' })).json()
  const previous = await (await post('/investigate', { runId: first.run.id, engine: 'deterministic' })).json()
  const second = await (await post('/start', { fault: 'payments' })).json()
  expect(second.edges).toEqual(first.edges)
  expect((await post('/rollback', { runId: first.run.id, approvalId: previous.run.approval.id })).status).toBe(409)
  const diagnosed = await (await post('/investigate', { runId: second.run.id, engine: 'deterministic' })).json()
  expect(diagnosed.run.diagnosis.rootCause).toBe('payments')
  expect(diagnosed.run.diagnosis.paths).toEqual([['checkout', 'payments']])
  expect(diagnosed.run.spans.filter((span: TraceSpan) => ['pricing', 'inventory', 'product-data'].includes(span.service)).every((span: TraceSpan) => span.ok)).toBe(true)
  const fixed = await (await post('/rollback', { runId: second.run.id, approvalId: diagnosed.run.approval.id })).json()
  expect(fixed.run.verification.status).toBe(200)
})
it('exposes read-only MCP tools, rejects arbitrary calls, and blocks reset while work is running', async () => {
  const { app, post } = fixture()
  const list = await (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json()
  expect(list.result.tools).toHaveLength(4)
  expect(list.result.tools.every((tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint)).toBe(true)
  const unknown = await (await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'run_arbitrary_query', arguments: { query: 'DELETE ALL' } } })).json()
  expect(unknown.error.code).toBe(-32602)
  const pending = post('/start', { fault: 'product-data' })
  expect((await post('/start', { fault: 'payments' })).status).toBe(409)
  await pending
  expect((await app.request('/mcp', { headers: { Origin: 'https://elsewhere.example' } })).status).toBe(403)
})

it('refuses to propose a rollback when only the suspicious deployment is supported', async () => {
  const graph = new MemoryIncidentGraph()
  const { post } = fixture(graph)
  const fired = await (await post('/start', { fault: 'product-data' })).json()
  graph.events = graph.events.filter(event => event.kind === 'deployment')
  const diagnosed = await (await post('/investigate', { runId: fired.run.id, engine: 'deterministic' })).json()
  expect(diagnosed.run.diagnosis.confidence).toBe('inconclusive')
  expect(diagnosed.run.diagnosis.rootCause).toBeNull()
  expect(diagnosed.run.approval).toBeNull()
  expect(diagnosed.services.map((service: { config: unknown }) => service.config)).toEqual(fired.services.map((service: { config: unknown }) => service.config))
})

it('validates MCP arguments, initialization, and the scope of the approved action', async () => {
  const { app, post } = fixture()
  const initialized = await (await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })).json()
  expect(initialized.result.protocolVersion).toBe('2025-03-26')
  expect((await post('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
  expect((await app.request('/mcp')).status).toBe(405)
  const fired = await (await post('/start', { fault: 'product-data' })).json()
  const invalid = await (await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'trace_dependencies', arguments: { root: 'checkout', query: 'DELETE ALL' } } })).json()
  expect(invalid.result.isError).toBe(true)
  const diagnosed = await (await post('/investigate', { runId: fired.run.id, engine: 'deterministic' })).json()
  expect((await post('/rollback', { runId: fired.run.id, approvalId: diagnosed.run.approval.id, target: 'payments' })).status).toBe(400)
  expect((await app.request('/services/not-a-service')).status).toBe(400)
})

it('requires a supporting graph path and revokes an earlier approval if that evidence disappears', async () => {
  const graph = new MemoryIncidentGraph()
  const { post } = fixture(graph)
  const fired = await (await post('/start', { fault: 'product-data' })).json()
  const initial = await (await post('/investigate', { runId: fired.run.id, engine: 'deterministic' })).json()
  expect(initial.run.diagnosis.rootCause).toBe('product-data')
  graph.paths = async () => []
  const changed = await (await post('/investigate', { runId: fired.run.id, engine: 'deterministic' })).json()
  expect(changed.run.diagnosis.confidence).toBe('inconclusive')
  expect(changed.run.approval).toBeNull()
  expect((await post('/rollback', { runId: fired.run.id, approvalId: initial.run.approval.id })).status).toBe(409)
})
