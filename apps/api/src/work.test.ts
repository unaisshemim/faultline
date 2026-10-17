import { describe, expect, it } from 'vitest'
import type { Snapshot } from '../../../shared/contracts.js'
import { seedSnapshot } from './seed.js'
import type { Store } from './graph.js'
import { WorkService } from './work.js'
import { createApp } from './app.js'
import { allowsCreation } from './chat-tools.js'

class MemoryStore implements Store {
  state: Snapshot
  constructor(state = seedSnapshot()) { this.state = structuredClone(state) }
  async read() { return structuredClone(this.state) }
  async write(state: Snapshot) { this.state = structuredClone(state) }
  async close() {}
}
const input = { title: 'Itron installation readiness report', description: 'Prepare a summary of current installation.', requiredResponsibility: 'installation', dueAt: '2030-12-01T17:00:00+05:30', effortHours: 4 }
const start = new Date('2030-11-01T09:00:00Z')
const fixture = () => { const store = new MemoryStore(seedSnapshot(start)); let now = start; const work = new WorkService(store, 120000, () => now); return { store, work, advance: (ms: number) => { now = new Date(now.getTime() + ms) } } }

describe('task lifecycle and durable follow-ups', () => {
  it('creates a persisted task and assignment message, idempotently', async () => {
    const { work, store } = fixture()
    const task = await work.createTask(input, 'founder:message-1')
    expect(task.ownerId).toBe('leena'); expect(task.status).toBe('awaiting_acceptance')
    expect(store.state.messages.filter(m => m.taskId === task.id)).toHaveLength(1)
    expect((await work.createTask(input, 'founder:message-1')).id).toBe(task.id)
    expect(store.state.tasks.filter(t => t.actionKey === 'founder:message-1')).toHaveLength(1)
  })
  it('serializes competing assignments and prevents overbooking', async () => {
    const { work } = fixture()
    const results = await Promise.all([work.createTask({ ...input, effortHours: 12 }, 'a'), work.createTask({ ...input, effortHours: 12 }, 'b')])
    expect(results.filter(t => t.ownerId === 'leena')).toHaveLength(1)
    expect(results.filter(t => t.status === 'unassigned')).toHaveLength(1)
  })
  it('stores unassigned tasks when no qualified employee can take them', async () => {
    const { work } = fixture()
    const task = await work.createTask({ ...input, requiredResponsibility: 'design' }, 'no-owner')
    expect(task.status).toBe('unassigned'); expect(task.ownerId).toBeNull(); expect(task.nextFollowUpAt).toBeNull()
  })
  it('requires owner identity, acceptance before updates, and text for blockers', async () => {
    const { work } = fixture(); const task = await work.createTask(input, 'a')
    await expect(work.respond(task.id, 'arjun', 'accept', '', '1')).rejects.toMatchObject({ status: 403 })
    await expect(work.respond(task.id, 'leena', 'complete', '', '2')).rejects.toMatchObject({ status: 409 })
    await work.respond(task.id, 'leena', 'accept', '', '3')
    await expect(work.respond(task.id, 'leena', 'blocked', '', '4')).rejects.toThrow('include an update')
  })
  it('keeps progress and blockers, and suppresses repeated response requests', async () => {
    const { work, store } = fixture(); const task = await work.createTask(input, 'a')
    await work.respond(task.id, 'leena', 'accept', '', '1')
    await work.respond(task.id, 'leena', 'blocked', 'Waiting for figures from finance.', '2')
    await work.respond(task.id, 'leena', 'blocked', 'Waiting for figures from finance.', '2')
    expect(store.state.tasks[0].status).toBe('blocked')
    expect(store.state.tasks[0].blockerText).toBe('Waiting for figures from finance.')
    expect(store.state.updates.filter(u => u.taskId === task.id && u.kind === 'blocked')).toHaveLength(1)
    await work.respond(task.id, 'leena', 'progress', 'Figures arrived.', '3')
    expect(store.state.tasks[0].blockerText).toBe('')
  })
  it('sends one due reminder per interval and resumes after service restart', async () => {
    const { work, store, advance } = fixture(); const task = await work.createTask(input, 'a')
    expect(await work.checkFollowUps()).toBe(0)
    advance(120000)
    expect(await work.checkFollowUps()).toBe(1)
    expect(await work.checkFollowUps()).toBe(0)
    const restored = new WorkService(store, 120000, () => new Date(start.getTime() + 240000))
    expect(await restored.checkFollowUps()).toBe(1)
    expect(store.state.messages.filter(m => m.taskId === task.id && m.kind === 'follow-up')).toHaveLength(2)
  })
  it('stops reminders after completion and frees capacity', async () => {
    const { work, store, advance } = fixture(); const task = await work.createTask(input, 'a')
    await work.respond(task.id, 'leena', 'accept', '', '1')
    await work.respond(task.id, 'leena', 'complete', '', '2')
    advance(600000); expect(await work.checkFollowUps()).toBe(0)
    expect(store.state.tasks[0].nextFollowUpAt).toBeNull()
    await expect(work.respond(task.id, 'leena', 'progress', 'Again', '3')).rejects.toMatchObject({ status: 409 })
  })
  it('declines without assigning another arbitrary employee and cancels without follow-ups', async () => {
    const { work, advance } = fixture(); const task = await work.createTask(input, 'a')
    const declined = await work.respond(task.id, 'leena', 'decline', '', '1')
    expect(declined.ownerId).toBeNull(); expect(declined.nextFollowUpAt).toBeNull()
    const another = await work.createTask(input, 'b'); await work.cancel(another.id)
    advance(600000); expect(await work.checkFollowUps()).toBe(0)
  })
  it('rejects past deadlines', async () => { const { work } = fixture(); await expect(work.createTask({ ...input, dueAt: '2020-01-01T00:00:00Z' }, 'a')).rejects.toThrow('future deadline') })
})

describe('Hono API and AI boundaries', () => {
  const makeApp = () => createApp(fixture().work, { key: undefined, model: 'gpt-4.1-mini', timezone: 'Asia/Kolkata' })
  it('returns work with capacities and explicit connection status', async () => {
    const response = await makeApp().request('/api/dashboard')
    expect(response.status).toBe(200)
    const data = await response.json(); expect(data.status.openai).toBe(false); expect(data.status.database).toBe(true)
    expect(data.employees.find((e: { id: string }) => e.id === 'leena').availableHours).toBe(16)
  })
  it('rejects bad actions and nonexistent tasks', async () => {
    const response = await makeApp().request('/api/tasks/task-vendors/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId: 'arjun', action: 'invented', requestId: '1' }) })
    expect(response.status).toBe(400)
    expect((await makeApp().request('/api/tasks/missing')).status).toBe(404)
  })
  it('does not pretend AI succeeded when no key is configured', async () => {
    const response = await makeApp().request('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(503); expect((await response.json()).error).toContain('Connect OpenAI')
  })
  it('rejects cross-origin browser mutations', async () => {
    const response = await makeApp().request('/api/tasks/task-vendors/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: '{}' })
    expect(response.status).toBe(403)
  })
  it('excludes creation for operational questions but allows task clarification', () => {
    expect(allowsCreation(['Prepare an installation report.', '4 hours, this Friday.'])).toBe(true)
    expect(allowsCreation(['Prepare an installation report.', 'Who has capacity?'])).toBe(false)
    expect(allowsCreation(['What is blocking operations?'])).toBe(false)
  })
})


it('lists saved conversation summaries without leaking full attachment payloads', async () => {
  const { work, store } = fixture()
  store.state.chats.push({ id: 'saved-chat', updatedAt: '2030-11-01T09:00:00Z', messages: [
    { id: 'u', role: 'user', parts: [{ type: 'text', text: 'Review the Itron handover' }, { type: 'file', mediaType: 'application/pdf', filename: 'handover.pdf', url: 'data:application/pdf;base64,YWJj' }] },
  ] })
  const response = await createApp(work).request('/api/chats')
  const summaries = await response.json()
  expect(summaries).toEqual([{ id: 'saved-chat', title: 'Review the Itron handover', updatedAt: '2030-11-01T09:00:00Z', messageCount: 1 }])
  expect(JSON.stringify(summaries)).not.toContain('base64')
})
