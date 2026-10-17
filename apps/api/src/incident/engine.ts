import { randomUUID } from 'node:crypto'
import { dependencyEdges, serviceNames, type ChangeRecord, type FaultTarget, type IncidentRun, type IncidentSnapshot, type ProbeResult, type ServiceConfig, type ServiceName, type TraceSpan } from '../../../../shared/incident.js'
import type { IncidentGraph } from './graph.js'
import { investigate } from './investigator.js'
import { incidentMcp, IncidentMcpClient } from './mcp.js'

export class IncidentError extends Error { constructor(message: string, readonly status: 400 | 404 | 409 | 503 = 409) { super(message) } }
type Dispatch = (service: ServiceName, headers: Record<string, string>, signal: AbortSignal) => Promise<Response>
const testRequest = 'GET /api/incident/services/checkout?sku=DEMO-001&quantity=1'
const safeConfig = (): ServiceConfig => ({ latencyMs: 8, revision: 1 })
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('TIMEOUT')); return }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new Error('TIMEOUT')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
export class IncidentEngine {
  run: IncidentRun | null = null
  private configs = new Map<ServiceName, ServiceConfig>(serviceNames.map(name => [name, safeConfig()]))
  private dispatch!: Dispatch
  private busy = false
  private connected = false
  readonly mcp: ReturnType<typeof incidentMcp>
  constructor(readonly graph: IncidentGraph, readonly agentConfig: { key?: string; model: string }) { this.mcp = incidentMcp(graph, () => this.run?.id) }
  bind(dispatch: Dispatch) { this.dispatch = dispatch }
  snapshot(): IncidentSnapshot {
    const latestSpans = this.run?.spans.filter(span => span.traceId === this.run?.latest.traceId) ?? []
    return structuredClone({ simulated: true, graphConnected: this.connected, aiConfigured: Boolean(this.agentConfig.key), edges: dependencyEdges, run: this.run, services: serviceNames.map(name => {
      const spans = latestSpans.filter(span => span.service === name)
      return { name, status: !spans.length ? 'unknown' as const : spans.every(span => span.ok) ? 'healthy' as const : 'failing' as const, latencyMs: spans.length ? Math.max(...spans.map(span => span.durationMs)) : null, config: this.configs.get(name)! }
    }) })
  }
  private async exclusive<T>(action: () => Promise<T>) {
    if (this.busy) throw new IncidentError('A sandbox operation is running. Wait for it to finish.')
    this.busy = true
    try { return await action() } finally { this.busy = false }
  }
  private requireRun(id: string) {
    if (!this.run || this.run.id !== id) throw new IncidentError('This incident is no longer active. Refresh before taking action.')
    return this.run
  }
  async start(fault: FaultTarget) {
    return this.exclusive(async () => {
      try { await this.graph.initialize(); this.connected = true } catch { this.connected = false; throw new IncidentError('FalkorDB is unavailable. Start the local database with npm run db:up, then retry.', 503) }
      this.graph.drainQueries()
      this.configs = new Map(serviceNames.map(name => [name, safeConfig()]))
      const changed = { latencyMs: 220, revision: 2 }
      const configuration: ChangeRecord = { id: randomUUID(), service: fault, kind: 'configuration', at: new Date().toISOString(), summary: 'upstream_latency_ms changed from 8 to 220; caller timeout budget remains unchanged.', before: JSON.stringify(safeConfig()), after: JSON.stringify(changed), revision: 2 }
      this.configs.set(fault, changed)
      const deployment: ChangeRecord = { id: randomUUID(), service: 'payments', kind: 'deployment', at: new Date().toISOString(), summary: 'payments v2.8.1 deployed (generated sandbox release event).', before: 'v2.8.0', after: 'v2.8.1', revision: 1 }
      const placeholder: ProbeResult = { traceId: '', ok: false, status: 0, durationMs: 0, request: testRequest, at: new Date().toISOString() }
      const run: IncidentRun = { id: randomUUID(), startedAt: new Date().toISOString(), state: 'firing', scenario: fault, spans: [], changes: [configuration, deployment], alerts: [], before: placeholder, latest: placeholder, verification: null, diagnosis: null, approval: null, queries: [] }
      this.run = run
      run.before = await this.probe(run, 'incident'); run.latest = run.before
      if (run.spans.filter(span => !span.ok).length < 5) run.latest = await this.probe(run, 'incident')
      const failures = run.spans.filter(span => !span.ok)
      run.alerts = failures.slice(0, 5).map(span => ({ id: randomUUID(), service: span.service, title: span.errorCode === 'TIMEOUT' ? `${span.service}: request timed out` : `${span.service}: dependency request failed`, evidenceIds: [span.id] }))
      if (run.alerts.length < 5) {
        const checkouts = failures.filter(span => span.service === 'checkout')
        run.alerts.push({ id: randomUUID(), service: 'checkout', title: `Checkout availability: 0/${checkouts.length} test requests succeeded`, evidenceIds: checkouts.map(span => span.id) })
      }
      await this.graph.save(run.id, run.spans, run.changes)
      return this.snapshot()
    })
  }
  private async invoke(service: ServiceName, run: IncidentRun, traceId: string, parentSpanId: string, phase: TraceSpan['phase'], budgetMs: number) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), budgetMs)
    try {
      return await this.dispatch(service, { 'x-incident-run': run.id, 'x-trace-id': traceId, 'x-parent-span': parentSpanId, 'x-probe-phase': phase }, controller.signal)
    } finally { clearTimeout(timeout) }
  }
  async service(service: ServiceName, request: Request): Promise<Response> {
    const run = this.run
    if (!run) return Response.json({ service, error: 'Trigger a sandbox incident first.' }, { status: 409 })
    const spanId = randomUUID(), traceId = request.headers.get('x-trace-id') || randomUUID()
    const parentSpanId = request.headers.get('x-parent-span') || ''
    const phase = (request.headers.get('x-probe-phase') || 'check') as TraceSpan['phase']
    const config = { ...this.configs.get(service)! }
    const start = performance.now(), startedAt = new Date().toISOString()
    let ok = true, status = 200, errorCode = '', message = `${service} request succeeded.`
    try {
      await delay(config.latencyMs, request.signal)
      const children = dependencyEdges.filter(([source]) => source === service).map(([, target]) => target)
      const results = await Promise.all(children.map(async child => {
        const response = await this.invoke(child, run, traceId, spanId, phase, service === 'checkout' ? 100 : 45)
        return { service: child, ok: response.ok, status: response.status }
      }))
      const failed = results.filter(result => !result.ok)
      if (failed.length) { ok = false; status = 503; errorCode = 'DEPENDENCY_FAILURE'; message = `${service} failed because ${failed.map(item => item.service).join(', ')} returned an error.` }
    } catch { ok = false; status = 504; errorCode = 'TIMEOUT'; message = `${service} exceeded its caller’s timeout budget with upstream_latency_ms=${config.latencyMs}.` }
    const durationMs = Math.round(performance.now() - start)
    run.spans.push({ id: spanId, traceId, parentSpanId, service, ok, status, errorCode, message, durationMs, startedAt, endedAt: new Date().toISOString(), configRevision: config.revision, phase })
    return Response.json({ service, ok, message, errorCode, spanId, traceId, durationMs, configRevision: config.revision }, { status })
  }
  private async probe(run: IncidentRun, phase: TraceSpan['phase']) {
    const traceId = randomUUID(), start = performance.now()
    const response = await this.invoke('checkout', run, traceId, '', phase, 500)
    return { traceId, ok: response.ok, status: response.status, durationMs: Math.round(performance.now() - start), request: testRequest, at: new Date().toISOString() }
  }
  async investigate(id: string, useAi: boolean) {
    return this.exclusive(async () => {
      const run = this.requireRun(id)
      if (run.state === 'recovered' || run.state === 'verification_failed') throw new IncidentError('This incident has already been acted on. Trigger a new incident to investigate again.')
      this.graph.drainQueries()
      const diagnosis = await investigate(new IncidentMcpClient(this.mcp), this.agentConfig, useAi)
      run.diagnosis = diagnosis; run.queries = this.graph.drainQueries(); run.state = 'diagnosed'
      if (!diagnosis.rootCause) run.approval = null
      if (diagnosis.rootCause && (!run.approval || run.approval.target !== diagnosis.rootCause || run.approval.expectedRevision !== this.configs.get(diagnosis.rootCause)!.revision)) {
        const change = run.changes.find(change => change.service === diagnosis.rootCause && change.kind === 'configuration')!
        run.approval = { id: randomUUID(), runId: id, target: diagnosis.rootCause, expectedRevision: this.configs.get(diagnosis.rootCause)!.revision, restoreRevision: JSON.parse(change.before).revision, state: 'pending' }
      }
      return this.snapshot()
    })
  }
  async rollback(id: string, approvalId: string) {
    return this.exclusive(async () => {
      const run = this.requireRun(id), action = run.approval
      if (!action || action.id !== approvalId || action.target !== run.diagnosis?.rootCause) throw new IncidentError('No matching approved sandbox action exists.')
      if (action.state === 'executed') return this.snapshot()
      if (this.configs.get(action.target)!.revision !== action.expectedRevision) throw new IncidentError('The configuration has changed since investigation. Investigate again.')
      const change = run.changes.find(change => change.service === action.target && change.kind === 'configuration')!
      const prior = this.configs.get(action.target)!, restored: ServiceConfig = { ...JSON.parse(change.before), revision: prior.revision + 1 }
      this.configs.set(action.target, restored); action.state = 'executed'
      run.changes.push({ id: randomUUID(), service: action.target, kind: 'rollback', at: new Date().toISOString(), summary: `Approved sandbox rollback restored config v${action.restoreRevision}; active revision is v${restored.revision}.`, before: JSON.stringify(prior), after: JSON.stringify(restored), revision: restored.revision })
      run.verification = await this.probe(run, 'verification'); run.latest = run.verification
      run.state = run.verification.ok ? 'recovered' : 'verification_failed'
      await this.graph.save(run.id, run.spans, run.changes)
      return this.snapshot()
    })
  }
  async check(id: string) {
    return this.exclusive(async () => {
      const run = this.requireRun(id)
      run.latest = await this.probe(run, 'check')
      await this.graph.save(run.id, run.spans, run.changes)
      return this.snapshot()
    })
  }
}
