import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, ArrowRight, Check, CheckCheck, ChevronDown, CircleDot, Code2, Database, GitBranch, Loader2, Play, RotateCcw, Search, ShieldCheck, Terminal, Workflow, X } from 'lucide-react'
import { Link } from 'react-router'
import { request } from '@/lib/api'
import { dependencyEdges, type ChangeRecord, type FaultTarget, type IncidentSnapshot, type ServiceName, type TraceSpan } from '../../../../shared/incident'
import './incident-lab.css'

const positions: Record<ServiceName, [number, number]> = { checkout: [110, 195], pricing: [365, 70], inventory: [365, 220], payments: [365, 350], 'product-data': [640, 145] }
const time = (value: string) => new Date(value).toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })
const short = (value: string) => value.slice(0, 8)
type Evidence = { kind: 'span'; record: TraceSpan } | { kind: 'change'; record: ChangeRecord }
export function IncidentLab() {
  const [snapshot, setSnapshot] = useState<IncidentSnapshot | null>(null)
  const [fault, setFault] = useState<FaultTarget>('product-data')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'evidence' | 'queries'>('evidence')
  const [selectedService, setSelectedService] = useState<ServiceName | null>(null)
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null)
  const [useAi, setUseAi] = useState(true)
  const load = useCallback(() => { void request<IncidentSnapshot>('/incident/status').then(setSnapshot).catch(error => setError(error.message)) }, [])
  useEffect(load, [load])
  useEffect(() => { const previous = document.title; document.title = 'Faultline · Incident Lab'; return () => { document.title = previous } }, [])
  const act = async (operation: 'start' | 'investigate' | 'rollback' | 'check') => {
    if (busy) return
    setBusy(operation); setError('')
    try {
      const body = operation === 'start' ? { fault } : operation === 'investigate' ? { runId: snapshot!.run!.id, engine: useAi ? 'auto' : 'deterministic' } : operation === 'rollback' ? { runId: snapshot!.run!.id, approvalId: snapshot!.run!.approval!.id } : { runId: snapshot!.run!.id }
      const data = await request<IncidentSnapshot>(`/incident/${operation}`, { method: 'POST', body: JSON.stringify(body) })
      setSnapshot(data)
      if (operation === 'start') { setSelectedService(null); setSelectedRecord(null); setTab('evidence') }
    } catch (error) { setError(error instanceof Error ? error.message : 'The sandbox request failed.') } finally { setBusy('') }
  }
  const run = snapshot?.run, diagnosis = run?.diagnosis, recovered = run?.state === 'recovered'
  const edges = snapshot?.edges ?? dependencyEdges
  const highlight = new Set(diagnosis?.paths.flatMap(path => path.slice(1).map((target, index) => `${path[index]}:${target}`)) ?? [])
  const latestSpans = run?.spans.filter(span => span.traceId === run.latest.traceId) ?? []
  const evidenceIds = selectedRecord ? [selectedRecord] : diagnosis?.evidenceIds
  let records: Evidence[] = run ? [
    ...run.changes.filter(record => record.kind !== 'rollback').map(record => ({ kind: 'change' as const, record })),
    ...run.spans.filter(record => record.phase === 'incident').map(record => ({ kind: 'span' as const, record })),
  ] : []
  if (evidenceIds) records = evidenceIds.flatMap(id => records.filter(item => item.record.id === id))
  if (selectedService) records = records.filter(item => item.record.service === selectedService)
  const selectService = (name: ServiceName) => { setSelectedService(value => value === name ? null : name); setSelectedRecord(null); setTab('evidence') }
  const inspectRecord = (id: string) => { setSelectedRecord(id); setSelectedService(null); setTab('evidence') }
  return <div className="incident-lab">
    <nav className="incident-topbar"><Link to="/" className="incident-brand"><Workflow size={20} /><strong>FAULTLINE</strong><span>incident lab</span></Link><div className="incident-environment"><span />Simulated environment<span className="environment-divider">/</span>Local sandbox</div><Link to="/" className="incident-workspace-link">Company Brain <ArrowRight size={14} /></Link></nav>
    <main className="incident-shell">
      <header className="incident-hero"><div><div className="incident-eyebrow">TRACK 01 <span> / </span> AGENTS THAT ACT ON CONNECTED DATA</div><h1>Five alerts. One underlying failure.</h1><p>Trace the dependencies. Challenge the obvious suspect. Verify the fix.</p></div><div className="incident-controls"><label>FAULT INJECTION<select aria-label="Fault injection target" value={fault} disabled={!!busy} onChange={event => setFault(event.target.value as FaultTarget)}><option value="product-data">Product-data configuration</option><option value="payments">Payments configuration</option></select></label><button className="incident-trigger" disabled={!!busy || !snapshot} onClick={() => void act('start')}>{busy === 'start' ? <Loader2 className="animate-spin" size={15} /> : <Play size={14} />}{run ? 'Restart incident' : 'Trigger incident'}</button></div></header>
      {error && <div className="incident-error" role="alert"><AlertTriangle size={15} />{error}<button onClick={() => { setError(''); load() }}>Retry connection</button></div>}
      <div className="incident-panels">
        <section className="incident-topology" aria-label="Service dependency graph">
          <div className="incident-panel-heading"><div><span className={`incident-phase-dot ${run ? recovered ? 'resolved' : 'firing' : ''}`} /><h2>Service topology</h2><span className="incident-count">5 services · 5 dependencies</span></div><span className={`incident-state ${recovered ? 'resolved' : run ? 'firing' : ''}`}>{recovered ? <Check size={12} /> : run ? <Activity size={12} /> : <CircleDot size={12} />}{recovered ? 'Recovered' : run ? 'Incident active' : 'Standing by'}</span></div>
          <div className="incident-graph-area"><svg viewBox="0 0 760 430" className="incident-service-graph" role="img" aria-label={`Checkout dependencies${diagnosis?.rootCause ? `, evidence points to ${diagnosis.rootCause}` : ''}`}>
            <defs><pattern id="incident-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#31363b" /></pattern><marker id="incident-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#49525c" /></marker><marker id="incident-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={recovered ? '#73c5aa' : '#e5bb78'} /></marker></defs>
            <rect width="760" height="430" fill="url(#incident-grid)" />
            {edges.map(([source, target]) => { const [sx, sy] = positions[source], [tx, ty] = positions[target], active = highlight.has(`${source}:${target}`); return <path key={`${source}:${target}`} d={`M ${sx + 82} ${sy} C ${sx + 145} ${sy}, ${tx - 145} ${ty}, ${tx - 85} ${ty}`} className={`incident-edge ${active ? recovered ? 'recovered' : 'highlighted' : ''}`} markerEnd={`url(#${active ? 'incident-arrow-active' : 'incident-arrow'})`} /> })}
            {Object.entries(positions).map(([name, [x, y]]) => {
              const service = snapshot?.services.find(service => service.name === name), failing = service?.status === 'failing', healthy = service?.status === 'healthy', root = diagnosis?.rootCause === name
              const span = latestSpans.find(span => span.service === name)
              return <g key={name} role="button" tabIndex={0} aria-label={`Inspect ${name}, ${service?.status ?? 'unknown'}`} onClick={() => selectService(name as ServiceName)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectService(name as ServiceName) } }} className={`incident-node ${root ? 'root-cause' : ''} ${failing ? 'failing' : healthy ? 'healthy' : ''} ${selectedService === name ? 'selected' : ''} ${recovered ? 'verified' : ''}`}>
                {root && <rect className="incident-root-halo" x={x - 87} y={y - 42} width="174" height="84" rx="13" />}
                <rect className="incident-node-body" x={x - 82} y={y - 36} width="164" height="72" rx="9" />
                <circle className="incident-node-dot" cx={x - 61} cy={y - 8} r="4" /><text className="incident-node-name" x={x - 48} y={y - 3}>{name}</text>
                <text className="incident-node-status" x={x - 60} y={y + 20}>{!run ? 'No request yet' : `${span?.errorCode === 'TIMEOUT' ? 'TIMEOUT' : healthy ? '200 OK' : '503 ERROR'}  ·  ${service?.latencyMs ?? '—'} ms`}</text>
                {root && <text className="incident-node-caption" x={x} y={y - 51} textAnchor="middle">{recovered ? 'FIX VERIFIED' : 'ROOT CAUSE'}</text>}
                {name === 'payments' && run && !root && <><rect className="incident-deploy-tag" x={x - 72} y={y + 47} width="144" height="24" rx="5" /><text className="incident-deploy-text" x={x} y={y + 63} textAnchor="middle">RECENT DEPLOY · v2.8.1</text></>}
              </g>
            })}
          </svg><div className="incident-graph-legend"><span><i className="legend-healthy" />Healthy</span><span><i className="legend-failing" />Failing</span><span><i className="legend-path" />{recovered ? 'Verified dependency path' : 'Evidence-supported path'}</span><small>Click a service to inspect its evidence</small></div></div>
          <div className="incident-alerts"><div className="incident-alerts-heading"><span><AlertTriangle size={13} />{run ? '5 generated alerts' : 'Alert feed'}</span><small>{run ? `Run ${short(run.id)}` : 'Waiting for an incident'}</small></div>{run ? <div className="incident-alert-list">{run.alerts.map((alert, index) => <button key={alert.id} onClick={() => inspectRecord(alert.evidenceIds[0])}><span className={`incident-alert-index ${recovered ? 'resolved' : ''}`}>{recovered ? <Check size={10} /> : `0${index + 1}`}</span><span>{alert.title}</span><code>{short(alert.evidenceIds[0])}</code><ArrowRight size={12} /></button>)}</div> : <div className="incident-no-alerts">Trigger the incident to execute checkout and collect real sandbox request failures.</div>}</div>
        </section>
        <section className="incident-investigation" aria-label="Investigation and evidence">
          <div className="incident-panel-heading"><div><Search size={15} /><h2>Investigation</h2></div><button className={`incident-engine-toggle ${useAi && snapshot?.aiConfigured ? 'ai' : ''}`} onClick={() => setUseAi(value => !value)} disabled={!!busy} title="AI discovers and selects read-only MCP tools when configured. The deterministic option uses the same graph evidence.">{useAi && snapshot?.aiConfigured ? 'AI + MCP' : 'RULES + MCP'}<ChevronDown size={11} /></button></div>
          <div className="incident-evidence-tabs"><button aria-pressed={tab === 'evidence'} onClick={() => setTab('evidence')}><Terminal size={13} />Evidence</button><button aria-pressed={tab === 'queries'} onClick={() => setTab('queries')}><Code2 size={13} />Graph queries<span>{run?.queries.length ?? 0}</span></button><span className="incident-graph-connection"><Database size={11} />{snapshot?.graphConnected ? 'FalkorDB connected' : 'FalkorDB · local'}</span></div>
          <div className="incident-investigation-scroll" aria-live="polite">
            {tab === 'queries' ? <div className="incident-query-list">{run?.queries.length ? run.queries.map((query, index) => <article className="incident-query" key={index}><header><span>0{index + 1}</span><strong>{query.tool}</strong><small>{query.rowCount} rows · {query.durationMs} ms</small></header><pre>{query.cypher}</pre><code>{JSON.stringify(query.parameters)}</code></article>) : <div className="incident-empty-evidence"><Code2 size={28} /><h3>No queries yet.</h3><p>The investigation will show every Cypher query, its actual parameters, and result count here.</p></div>}</div> : <>
              {!diagnosis ? <div className={`incident-investigate-intro ${selectedRecord || selectedService ? 'has-filter' : ''}`}><span className="incident-crosshair"><Search size={23} /></span><span className="incident-eyebrow">FOLLOW THE EVIDENCE</span><h3>{run ? 'Five alerts. Where do they converge?' : 'The obvious suspect can be wrong.'}</h3><p>{run ? 'A recent payments deployment looks suspicious. Trace checkout’s dependencies and compare the actual request logs before acting.' : 'Start a generated incident. The agent will use FalkorDB paths, request traces, and configuration changes to find the underlying failure.'}</p>{run && <div className="incident-suspect"><GitBranch size={14} /><span>payments v2.8.1</span><small>recent deployment · unverified suspect</small></div>}<button className="incident-investigate-button" onClick={() => void act('investigate')} disabled={!run || !!busy}>{busy === 'investigate' ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}{busy === 'investigate' ? 'Investigating graph & traces…' : 'Investigate incident'}<ArrowRight size={14} /></button><small className="incident-readonly">Read-only investigation · no service changes</small></div> : <div className="incident-diagnosis"><div className="incident-diagnosis-label"><span className={recovered ? 'resolved' : ''}><CheckCheck size={13} />{diagnosis.confidence === 'supported' ? 'EVIDENCE SUPPORTED' : 'INCONCLUSIVE'}</span><small>{diagnosis.engine === 'ai-mcp' ? 'AI investigator · MCP tools' : 'Deterministic investigator · MCP tools'}</small></div><h3>{diagnosis.summary}</h3><p>{diagnosis.explanation}</p>{diagnosis.eliminated.map(item => <div className="incident-exonerated" key={item.service}><ShieldCheck size={18} /><div><strong>{item.service} ruled out</strong><p>{item.reason}</p></div></div>)}<div className="incident-path-list">{diagnosis.paths.map(path => <div key={path.join(':')}>{path.map((name, index) => <span key={name}>{index > 0 && <ArrowRight size={11} />}<button onClick={() => selectService(name)}>{name}</button></span>)}</div>)}</div><details className="incident-agent-note"><summary>{run!.queries.length} graph queries executed <ChevronDown size={11} /></summary><p>{diagnosis.agentNote}</p><button onClick={() => setTab('queries')}>Inspect Cypher queries <ArrowRight size={11} /></button></details></div>}
              {run && (diagnosis || selectedRecord || selectedService) && <div className="incident-records"><div className="incident-records-title"><h4>SUPPORTING RECORDS <span>{records.length}</span></h4>{(selectedRecord || selectedService) && <button onClick={() => { setSelectedRecord(null); setSelectedService(null) }}>{selectedService || 'Selected alert'}<X size={12} /></button>}</div>{records.map(item => <article className={`incident-record ${item.kind === 'span' ? item.record.ok ? 'success' : 'failure' : 'change'}`} key={item.record.id}><header><span className="incident-record-type">{item.kind === 'span' ? `${item.record.status} ${item.record.errorCode || 'OK'}` : item.record.kind.toUpperCase()}</span><strong>{item.record.service}</strong><time>{time(item.kind === 'span' ? item.record.startedAt : item.record.at)}</time></header><p>{item.kind === 'span' ? item.record.message : item.record.summary}</p><div className="incident-record-meta"><code>{item.kind === 'span' ? `span ${short(item.record.id)} · trace ${short(item.record.traceId)}` : `event ${short(item.record.id)}`}</code>{item.kind === 'span' && <span>{item.record.durationMs} ms · config v{item.record.configRevision}</span>}</div><details><summary>Raw record <ChevronDown size={10} /></summary><pre>{JSON.stringify(item.record, null, 2)}</pre></details></article>)}{!records.length && <p className="incident-no-records">No supporting records match this selection.</p>}</div>}
            </>}
          </div>
        </section>
      </div>
      <section className={`incident-action-dock ${recovered ? 'recovered' : ''}`} aria-label="Approved sandbox action and verification">
        <div className="incident-action-plan"><span className="incident-action-icon">{recovered ? <ShieldCheck size={20} /> : <RotateCcw size={20} />}</span><div><span className="incident-eyebrow">{recovered ? 'SANDBOX ACTION COMPLETED' : 'ONE APPROVED SANDBOX ACTION'}</span><h3>{recovered ? `Configuration reverted on ${run!.approval!.target}` : run?.approval ? `Revert ${run.approval.target} configuration` : 'Find the cause before changing anything'}</h3><p>{run?.approval ? `Scope: ${run.approval.target} only · restore values from config v${run.approval.restoreRevision}` : 'The agent proposes a targeted rollback after it has supporting evidence.'}</p></div></div>
        <button className="incident-approve-button" disabled={!run?.approval || run.approval.state !== 'pending' || !!busy} onClick={() => void act('rollback')}>{busy === 'rollback' ? <Loader2 size={15} className="animate-spin" /> : recovered ? <Check size={15} /> : <RotateCcw size={15} />}{busy === 'rollback' ? 'Reverting & testing…' : recovered ? 'Fix verified' : 'Revert configuration in sandbox'}</button>
        <div className="incident-verification"><div><span className="incident-eyebrow">SAME CHECKOUT REQUEST</span><button disabled={!run || !!busy} onClick={() => void act('check')} title="Execute the checkout endpoint again"><Activity size={12} />Run health check</button></div><div className="incident-probe-results"><span className={run ? 'probe-bad' : ''}>{run ? `HTTP ${run.before.status}` : 'Before'}<small>{run ? `${run.before.durationMs} ms` : 'awaiting incident'}</small></span><ArrowRight size={16} /><span className={run?.verification?.ok ? 'probe-good' : run?.verification ? 'probe-bad' : ''}>{run?.verification ? `HTTP ${run.verification.status}` : 'After'}<small>{run?.verification ? `${run.verification.durationMs} ms · ${run.verification.ok ? 'recovered' : 'still failing'}` : 'awaiting approval'}</small></span></div></div>
      </section>
      <footer className="incident-footer"><span><Terminal size={11} /><code>GET /api/incident/services/checkout?sku=DEMO-001&amp;quantity=1</code></span><span>{run ? `Latest test: HTTP ${run.latest.status} · ${run.latest.durationMs} ms` : 'Executable local endpoints · generated traces · real graph queries'}</span></footer>
    </main>
  </div>
}
