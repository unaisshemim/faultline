export const serviceNames = ['checkout', 'pricing', 'inventory', 'payments', 'product-data'] as const
export type ServiceName = typeof serviceNames[number]
export type FaultTarget = 'product-data' | 'payments'
export const dependencyEdges: [ServiceName, ServiceName][] = [
  ['checkout', 'pricing'], ['checkout', 'inventory'], ['checkout', 'payments'],
  ['pricing', 'product-data'], ['inventory', 'product-data'],
]
export interface ServiceConfig { latencyMs: number; revision: number }
export interface TraceSpan {
  id: string; traceId: string; parentSpanId: string; service: ServiceName
  ok: boolean; status: number; errorCode: string; message: string
  durationMs: number; startedAt: string; endedAt: string; configRevision: number; phase: 'incident' | 'verification' | 'check'
}
export interface ChangeRecord {
  id: string; service: ServiceName; kind: 'configuration' | 'deployment' | 'rollback'; at: string
  summary: string; before: string; after: string; revision: number
}
export interface ProbeResult { traceId: string; ok: boolean; status: number; durationMs: number; request: string; at: string }
export interface IncidentAlert { id: string; service: ServiceName; title: string; evidenceIds: string[] }
export interface QueryRecord { tool: string; cypher: string; parameters: Record<string, unknown>; rowCount: number; durationMs: number }
export interface Diagnosis {
  rootCause: ServiceName | null; summary: string; explanation: string; paths: ServiceName[][]
  evidenceIds: string[]; eliminated: { service: ServiceName; reason: string; evidenceIds: string[] }[]
  confidence: 'supported' | 'inconclusive'; engine: 'ai-mcp' | 'deterministic-mcp'; agentNote: string
}
export interface IncidentApproval { id: string; runId: string; target: ServiceName; expectedRevision: number; restoreRevision: number; state: 'pending' | 'executed' }
export interface IncidentRun {
  id: string; startedAt: string; state: 'firing' | 'diagnosed' | 'recovered' | 'verification_failed'
  scenario: FaultTarget; alerts: IncidentAlert[]; spans: TraceSpan[]; changes: ChangeRecord[]
  before: ProbeResult; latest: ProbeResult; verification: ProbeResult | null; diagnosis: Diagnosis | null
  approval: IncidentApproval | null; queries: QueryRecord[]
}
export interface IncidentSnapshot {
  simulated: true; graphConnected: boolean; aiConfigured: boolean
  services: { name: ServiceName; status: 'unknown' | 'healthy' | 'failing'; latencyMs: number | null; config: ServiceConfig }[]
  edges: [ServiceName, ServiceName][]; run: IncidentRun | null
}
