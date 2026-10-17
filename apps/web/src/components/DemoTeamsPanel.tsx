import { useState } from 'react'
import { MessageSquare, Send, Check, AlertCircle, Loader2, X, CircleHelp } from 'lucide-react'
import type { WorkData, ResponseAction, Task } from '../../../../shared/contracts'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { respondToTask } from '@/lib/api'
import { Avatar, StatusBadge, relativeTime } from './WorkUI'

export function DemoTeamsPanel({ open, onOpenChange, data, onChanged, initialTask }: { open: boolean; onOpenChange: (open: boolean) => void; data: WorkData; initialTask?: Task; onChanged: () => void }) {
  const [employeeId, setEmployeeId] = useState(initialTask?.ownerId || 'arjun')
  const [taskId, setTaskId] = useState(initialTask?.id || 'task-vendors')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<ResponseAction>('progress')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const employee = data.employees.find(e => e.id === employeeId)
  const tasks = data.tasks.filter(t => t.ownerId === employeeId)
  const task = tasks.find(t => t.id === taskId) ?? tasks[0]
  const chosenTaskId = task?.id ?? ''
  const messages = data.messages.filter(m => m.employeeId === employeeId && m.taskId === chosenTaskId)
  const closed = task?.status === 'completed' || task?.status === 'cancelled'
  const respond = async (action: ResponseAction) => {
    if (!task || busy) return
    setBusy(true); setError('')
    try { await respondToTask(task.id, employeeId, action, text); setText(''); onChanged() } catch (err) { setError(err instanceof Error ? err.message : 'Could not send update.') } finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="teams-dialog"><DialogHeader><div className="teams-heading"><span className="teams-logo"><MessageSquare size={20} /></span><div><DialogTitle>Employee conversation</DialogTitle><DialogDescription>Itron team simulator · illustrative staff · no real messages sent</DialogDescription></div></div></DialogHeader>
    <div className="teams-selectors"><div><label>Respond as</label><Select value={employeeId} onValueChange={value => { setEmployeeId(value); setError(''); setText('') }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{data.employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select></div><div><label>Task</label><Select value={chosenTaskId || undefined} onValueChange={value => { setTaskId(value); setError(''); setText('') }} disabled={!tasks.length}><SelectTrigger><SelectValue placeholder="No assigned tasks" /></SelectTrigger><SelectContent>{tasks.map(t => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent></Select></div></div>
    {task ? <><div className="teams-task"><strong>{task.title}</strong><StatusBadge status={task.status} /></div><div className="teams-messages" aria-live="polite">{messages.length ? messages.map(message => <div key={message.id} className={`teams-message ${message.direction}`}><div className="message-author">{message.direction === 'outgoing' ? <><span className="bot-dot">✦</span> Company Brain</> : <><Avatar employee={employee} small /> {employee?.name.split(' ')[0]}</>}<span>{relativeTime(message.createdAt)}</span></div><p>{message.text}</p>{message.kind === 'follow-up' && <Badge variant="outline">Automatic follow-up</Badge>}</div>) : <div className="empty-small">Your conversation will appear here.</div>}</div>
    <div className="teams-reply">{closed ? <p className="closed-note"><Check size={16} /> This task is closed. Follow-ups have stopped.</p> : <><Textarea value={text} onChange={e => setText(e.target.value)} placeholder="e.g. Meter delivery confirmed; gateway commissioning is pending…" aria-label="Employee update" disabled={busy || !data.status.database} />{task.status === 'awaiting_acceptance' ? <div className="response-actions"><Button onClick={() => void respond('accept')} disabled={busy || !data.status.database}><Check size={14} /> Accept</Button><Button variant="outline" onClick={() => void respond('decline')} disabled={busy || !data.status.database}><X size={14} /> Decline</Button><Button variant="ghost" onClick={() => void respond('clarify')} disabled={busy || !text.trim() || !data.status.database}><CircleHelp size={14} /> Ask a question</Button></div> : <div className="response-actions"><Select value={kind} onValueChange={value => setKind(value as ResponseAction)}><SelectTrigger className="update-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="progress">Progress update</SelectItem><SelectItem value="blocked">Report a blocker</SelectItem><SelectItem value="clarify">Ask a question</SelectItem></SelectContent></Select><Button onClick={() => void respond(kind)} disabled={busy || !text.trim() || !data.status.database}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send</Button><Button variant="ghost" onClick={() => void respond('complete')} disabled={busy || !data.status.database}><Check size={14} /> Complete</Button></div>}</>}{error && <p className="inline-error" role="alert"><AlertCircle size={13} /> {error}</p>}</div></> : <div className="teams-empty"><Avatar employee={employee} /><p>No work assigned to {employee?.name.split(' ')[0]} yet.</p><span>Create a task through the founder conversation.</span></div>}
    <p className="demo-footnote">Demo check-ins run every {Math.round(data.status.followUpIntervalMs / 60_000)} minutes. Seeded tasks begin check-ins after their first new reply.</p>
  </DialogContent></Dialog>
}
