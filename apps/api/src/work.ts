import type { UIMessage, ToolUIPart } from 'ai'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Snapshot, Task, ResponseAction, WorkData, SystemStatus } from '../../../shared/contracts.js'
import { terminalStatuses } from '../../../shared/contracts.js'
import type { Store } from './graph.js'
import { calculateCapacity, suggestOwner, assignmentSchema } from './assignment.js'

export const taskInputSchema = assignmentSchema.extend({ title: z.string().trim().min(3).max(200), description: z.string().trim().min(1).max(4000), dueAt: z.iso.datetime({ offset: true }) })
export class WorkError extends Error { constructor(message: string, public status: 400 | 403 | 404 | 409 | 503 = 400) { super(message) } }
export class WorkService {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly store: Store, readonly followUpIntervalMs = 120_000, private readonly clock = () => new Date()) {}
  async mutate<T>(fn: (state: Snapshot) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => { const state = await this.store.read(); const result = await fn(state); await this.store.write(state); return result })
    this.queue = operation.catch(() => {})
    return operation
  }
  async data(status: SystemStatus): Promise<WorkData> {
    const state = await this.store.read()
    return this.toWorkData(state, status)
  }
  toWorkData(state: Snapshot, status: SystemStatus): WorkData {
    return { ...state, employees: calculateCapacity(state), counts: { active: state.tasks.filter(t => !terminalStatuses.includes(t.status)).length, blocked: state.tasks.filter(t => t.status === 'blocked').length, overdue: state.tasks.filter(t => !terminalStatuses.includes(t.status) && new Date(t.dueAt) < this.clock()).length, completed: state.tasks.filter(t => t.status === 'completed').length }, status }
  }
  async createTask(input: z.infer<typeof taskInputSchema>, actionKey: string): Promise<Task> {
    const draft = taskInputSchema.parse(input)
    return this.mutate(state => this.createTaskInState(state, draft, actionKey))
  }
  private createTaskInState(state: Snapshot, draft: z.infer<typeof taskInputSchema>, actionKey: string): Task {
    const existing = state.tasks.find(t => t.actionKey === actionKey)
    if (existing) return existing
    if (new Date(draft.dueAt).getTime() <= this.clock().getTime()) throw new WorkError('Please choose a future deadline.')
    const decision = suggestOwner(state, draft)
    const now = this.clock().toISOString()
    const task: Task = { ...draft, requiredResponsibility: draft.requiredResponsibility.toLowerCase(), id: `task-${randomUUID()}`, ownerId: decision.owner?.id ?? null, status: decision.owner ? 'awaiting_acceptance' : 'unassigned', assignmentReason: decision.reason, blockerText: '', createdAt: now, lastUpdateAt: now, nextFollowUpAt: decision.owner ? new Date(this.clock().getTime() + this.followUpIntervalMs).toISOString() : null, actionKey }
    state.tasks.unshift(task)
    state.updates.unshift({ id: randomUUID(), taskId: task.id, employeeId: null, text: decision.owner ? `Assigned to ${decision.owner.name}. Waiting for acceptance.` : decision.reason, kind: 'assignment', createdAt: now, origin: 'system' })
    if (task.ownerId) state.messages.push({ id: randomUUID(), taskId: task.id, employeeId: task.ownerId, direction: 'outgoing', text: `Can you take this on? ${task.title}. ${task.description} Estimated effort: ${task.effortHours}h. Due: ${task.dueAt}.`, kind: 'assignment', createdAt: now, dedupeKey: `assignment:${task.id}` })
    return task
  }
  async approveTask(chatId: string, approvalId: string, approved: boolean): Promise<UIMessage[]> {
    return this.mutate(state => {
      const chat = state.chats.find(c => c.id === chatId)
      if (!chat) throw new WorkError('Conversation not found.', 404)
      const history = chat.messages as UIMessage[]
      const messageIndex = history.findIndex(message => message.role === 'assistant' && message.parts.some(part => part.type === 'tool-createTask' && 'approval' in part && part.approval?.id === approvalId))
      const message = history[messageIndex]
      const part = message?.parts.find(part => part.type === 'tool-createTask' && 'approval' in part && part.approval?.id === approvalId) as ToolUIPart | undefined
      if (!part || !part.approval) throw new WorkError('Task approval not found.', 404)
      if (part.state !== 'approval-requested') {
        if (part.approval.approved === approved && ['output-available', 'output-denied'].includes(part.state)) return history
        throw new WorkError('This task approval has already been resolved.', 409)
      }
      const origin = history.slice(0, messageIndex).reverse().find(item => item.role === 'user')
      if (!origin) throw new WorkError('The original task request is missing.', 409)
      const index = message.parts.indexOf(part)
      if (approved) {
        const draft = taskInputSchema.parse(part.input)
        const task = this.createTaskInState(state, draft, `${chatId}:${origin.id}`)
        message.parts[index] = { ...part, state: 'output-available', output: { task }, approval: { ...part.approval, approved: true } } as ToolUIPart
      } else {
        message.parts[index] = { ...part, state: 'output-denied', approval: { ...part.approval, approved: false, reason: 'Rejected by the user.' } } as ToolUIPart
      }
      chat.updatedAt = this.clock().toISOString()
      return history
    })
  }
  async respond(taskId: string, employeeId: string, action: ResponseAction, text: string, requestId: string) {
    return this.mutate(state => {
      const task = state.tasks.find(t => t.id === taskId)
      if (!task) throw new WorkError('Task not found.', 404)
      const key = `reply:${taskId}:${requestId}`
      if (state.messages.some(m => m.dedupeKey === key)) return task
      if (task.ownerId !== employeeId) throw new WorkError('Only the assigned employee can respond to this task.', 403)
      if (terminalStatuses.includes(task.status)) throw new WorkError('This task is already closed.', 409)
      if (action === 'accept' && task.status !== 'awaiting_acceptance') throw new WorkError('This task is already accepted.', 409)
      if (action === 'decline' && task.status !== 'awaiting_acceptance') throw new WorkError('Accepted work cannot be declined; report a blocker instead.', 409)
      if (['progress', 'blocked', 'complete'].includes(action) && task.status === 'awaiting_acceptance') throw new WorkError('Accept the task before sending progress or completion.', 409)
      if (['progress', 'blocked', 'clarify'].includes(action) && !text.trim()) throw new WorkError('Please include an update.')
      const now = this.clock().toISOString()
      const defaults = { accept: 'I can take this on.', decline: 'I’m unavailable for this task.', complete: 'This task is complete.' }
      const message = text.trim() || defaults[action as keyof typeof defaults] || action
      state.messages.push({ id: randomUUID(), taskId, employeeId, direction: 'incoming', text: message, kind: action, createdAt: now, dedupeKey: key })
      state.updates.unshift({ id: randomUUID(), taskId, employeeId, text: message, kind: action, createdAt: now, origin: 'employee' })
      if (action === 'accept') task.status = 'accepted'
      if (action === 'progress') { task.status = 'in_progress'; task.blockerText = '' }
      if (action === 'blocked') { task.status = 'blocked'; task.blockerText = message }
      if (action === 'complete') { task.status = 'completed'; task.blockerText = '' }
      if (action === 'decline') { task.status = 'unassigned'; task.ownerId = null; task.assignmentReason = `${state.employees.find(e => e.id === employeeId)?.name} declined. Ask Company Brain to create replacement work or adjust ownership in a later version.` }
      task.lastUpdateAt = now
      task.nextFollowUpAt = terminalStatuses.includes(task.status) || !task.ownerId ? null : new Date(this.clock().getTime() + this.followUpIntervalMs).toISOString()
      return task
    })
  }
  async cancel(taskId: string) {
    return this.mutate(state => {
      const task = state.tasks.find(t => t.id === taskId)
      if (!task) throw new WorkError('Task not found.', 404)
      if (terminalStatuses.includes(task.status)) throw new WorkError('This task is already closed.', 409)
      task.status = 'cancelled'; task.nextFollowUpAt = null; task.lastUpdateAt = this.clock().toISOString()
      state.updates.unshift({ id: randomUUID(), taskId, employeeId: null, text: 'Founder cancelled this task.', kind: 'cancel', origin: 'system', createdAt: task.lastUpdateAt })
      return task
    })
  }
  async checkFollowUps() {
    return this.mutate(state => {
      let sent = 0
      const now = this.clock()
      for (const task of state.tasks) {
        if (!task.ownerId || !task.nextFollowUpAt || terminalStatuses.includes(task.status) || new Date(task.nextFollowUpAt) > now) continue
        const key = `follow-up:${task.id}:${task.nextFollowUpAt}`
        if (!state.messages.some(m => m.dedupeKey === key)) {
          state.messages.push({ id: randomUUID(), taskId: task.id, employeeId: task.ownerId, direction: 'outgoing', text: `Any update on “${task.title}”?${task.status === 'blocked' ? ' Is there anything you need to move forward?' : ''}`, kind: 'follow-up', createdAt: now.toISOString(), dedupeKey: key })
          sent++
        }
        task.nextFollowUpAt = new Date(now.getTime() + this.followUpIntervalMs).toISOString()
      }
      return sent
    })
  }
}
