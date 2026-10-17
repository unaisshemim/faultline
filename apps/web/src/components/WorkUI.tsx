import type { Employee, TaskStatus } from '../../../../shared/contracts'
import { PersonAvatar } from './PersonAvatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function Avatar({ employee, small = false }: { employee?: Employee; small?: boolean }) {
  return <PersonAvatar id={employee?.id} name={employee?.name || 'Company Brain'} initials={employee?.initials || 'CB'} className={cn(employee?.color || 'blue', small && 'small')} />
}
export const statusLabels: Record<TaskStatus, string> = { unassigned: 'Needs an owner', awaiting_acceptance: 'Awaiting acceptance', accepted: 'Accepted', in_progress: 'In progress', blocked: 'Blocked', completed: 'Completed', cancelled: 'Cancelled' }
export function StatusBadge({ status }: { status: TaskStatus }) { return <Badge variant="outline" className={cn('status-badge', status)}>{statusLabels[status]}</Badge> }
export function dueLabel(date: string, timezone = 'Asia/Kolkata') {
  const nowDay = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(date))
  if (day === nowDay) return 'Today'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: timezone }).format(new Date(date))
}
export function relativeTime(date: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60_000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}
