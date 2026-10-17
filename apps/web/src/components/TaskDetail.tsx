import { useState } from 'react'
import { CalendarDays, Clock3, ArrowUpRight, CircleAlert, Loader2 } from 'lucide-react'
import type { Task, WorkData } from '../../../../shared/contracts'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cancelTask } from '@/lib/api'
import { Avatar, StatusBadge, relativeTime } from './WorkUI'

export function TaskDetail({ task, data, onClose, onChanged, onDemo }: { task: Task | undefined; data: WorkData; onClose: () => void; onChanged: () => void; onDemo: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owner = data.employees.find(e => e.id === task?.ownerId)
  const closed = task?.status === 'completed' || task?.status === 'cancelled'
  const cancel = async () => { if (!task) return; setBusy(true); try { await cancelTask(task.id); onChanged(); setError('') } catch (err) { setError(err instanceof Error ? err.message : 'Could not cancel task.') } finally { setBusy(false) } }
  return <Dialog open={Boolean(task)} onOpenChange={open => { if (!open) { onClose(); setError('') } }}><DialogContent className="task-dialog"><DialogHeader><span className="eyebrow">TASK DETAILS</span><DialogTitle className="detail-title">{task?.title}</DialogTitle><DialogDescription>{task?.description}</DialogDescription></DialogHeader>{task && <>
    <div className="task-metadata"><StatusBadge status={task.status} /><span><CalendarDays size={14} /> {new Date(task.dueAt).toLocaleString('en', { timeZone: data.status.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span><Clock3 size={14} /> {task.effortHours}h estimated</span></div>
    <div className="owner-explanation"><div><Avatar employee={owner} /><span><strong>{owner?.name || 'No owner yet'}</strong><span>{owner?.role || 'No eligible employee with capacity'}</span></span></div><p>{task.assignmentReason}</p></div>
    {task.blockerText && <div className="blocker-callout"><CircleAlert size={16} /><div><strong>Waiting on something</strong><p>{task.blockerText}</p></div></div>}
    <div className="detail-updates"><h3>Updates</h3>{data.updates.filter(u => u.taskId === task.id).map(u => <div className="detail-update" key={u.id}><span className="timeline-dot" /><div><span>{u.origin === 'employee' ? data.employees.find(e => e.id === u.employeeId)?.name : 'Company Brain'} <small>· {u.origin === 'employee' ? 'Employee confirmed' : 'System'} · {relativeTime(u.createdAt)}</small></span><p>{u.text}</p></div></div>)}</div>
    <div className="detail-actions"><span>{closed ? 'Follow-ups stopped' : task.nextFollowUpAt ? `Next demo check-in ${new Date(task.nextFollowUpAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}` : 'Check-ins start after the next employee reply'}</span><Button variant="outline" size="sm" onClick={() => { onClose(); onDemo() }}>Employee simulator <ArrowUpRight size={13} /></Button></div>
    {!closed && <Button variant="ghost" size="sm" className="cancel-task" disabled={busy || !data.status.database} onClick={() => void cancel()}>{busy && <Loader2 size={13} className="animate-spin" />} Cancel task</Button>}{error && <p className="inline-error">{error}</p>}
  </>}</DialogContent></Dialog>
}
