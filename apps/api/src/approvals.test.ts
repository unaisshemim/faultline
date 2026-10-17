import { expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { seedSnapshot } from './seed.js'
import { WorkService } from './work.js'
import { createApp } from './app.js'
import type { Snapshot } from '../../../shared/contracts.js'

const draft = { title: 'Itron calibration approval demo', description: 'Bench-test demo meter calibration.', requiredResponsibility: 'calibration', effortHours: 4, dueAt: '2030-12-01T12:00:00Z' }
function fixture() {
  let state = seedSnapshot(new Date('2030-11-01T12:00:00Z'))
  state.chats.push({ id: 'chat', updatedAt: '2030-11-01T12:00:00Z', messages: [
    { id: 'user', role: 'user', parts: [{ type: 'text', text: 'Create an Itron calibration task.' }] },
    { id: 'assistant', role: 'assistant', parts: [{ type: 'tool-createTask', toolCallId: 'call', state: 'approval-requested', input: draft, approval: { id: 'approval' } }] },
  ] })
  const store = { read: async () => structuredClone(state), write: async (next: Snapshot) => { state = structuredClone(next) }, close: async () => {} }
  const work = new WorkService(store, 120000, () => new Date('2030-11-01T12:00:00Z'))
  return { work, store, app: createApp(work) }
}
it('creates only after approval, using the stored draft, and retries without duplicate tasks or messages', async () => {
  const { work, store } = fixture()
  const before = await store.read()
  expect(before.tasks.some(t => t.actionKey === 'chat:user')).toBe(false)
  await Promise.all([work.approveTask('chat', 'approval', true), work.approveTask('chat', 'approval', true)])
  const after = await store.read()
  expect(after.tasks.filter(t => t.actionKey === 'chat:user')).toHaveLength(1)
  const task = after.tasks.find(t => t.actionKey === 'chat:user')!
  expect(task.ownerId).toBe('kavya')
  expect(after.messages.filter(m => m.taskId === task.id)).toHaveLength(1)
  expect(JSON.stringify(after.chats)).toContain('output-available')
  await expect(work.approveTask('chat', 'approval', false)).rejects.toMatchObject({ status: 409 })
})
it('persists rejection without creating tasks, reminders, or assignment messages', async () => {
  const { work, store } = fixture()
  const before = await store.read()
  await work.approveTask('chat', 'approval', false)
  await work.approveTask('chat', 'approval', false)
  const after = await store.read()
  expect(after.tasks).toEqual(before.tasks)
  expect(after.messages).toEqual(before.messages)
  expect(JSON.stringify(after.chats)).toContain('output-denied')
  await expect(work.approveTask('chat', 'approval', true)).rejects.toMatchObject({ status: 409 })
})
it('rejects unknown approvals and client-supplied changes to the task proposal', async () => {
  const { app } = fixture()
  const post = (body: unknown) => app.request('/api/chat/chat/approval', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  expect((await post({ approvalId: 'invented', approved: true })).status).toBe(404)
  expect((await post({ approvalId: 'approval', approved: true, input: { ...draft, effortHours: 1 } })).status).toBe(400)
  expect((await post({ approvalId: 'approval', approved: false })).status).toBe(200)
})
it('rechecks capacity and expired deadlines at approval time', async () => {
  const { work, store } = fixture()
  await work.createTask({ ...draft, title: 'Other calibration work', effortHours: 18 }, 'other')
  await work.approveTask('chat', 'approval', true)
  expect((await store.read()).tasks.find(t => t.actionKey === 'chat:user')?.ownerId).toBeNull()
  const expired = fixture()
  await expired.work.mutate(state => { ((state.chats[0].messages[1] as UIMessage).parts[0] as { input: typeof draft }).input.dueAt = '2020-01-01T00:00:00Z' })
  await expect(expired.work.approveTask('chat', 'approval', true)).rejects.toThrow('future deadline')
  expect(JSON.stringify((await expired.store.read()).chats)).toContain('approval-requested')
})
