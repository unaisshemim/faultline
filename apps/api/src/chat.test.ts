import { expect, it, vi } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import type { Snapshot } from '../../../shared/contracts.js'
import { seedSnapshot } from './seed.js'
import { WorkService } from './work.js'
import { chatHandler } from './chat.js'

const provider = vi.hoisted(() => ({ model: undefined as unknown }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: () => () => provider.model }))
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
const input = { title: 'Itron installation report', description: 'Prepare installation figures.', requiredResponsibility: 'installation', dueAt: '2030-12-01T12:00:00Z', effortHours: 4 }
function currentWorkStep(id: string) {
  return { stream: simulateReadableStream({ chunks: [
    { type: 'stream-start' as const, warnings: [] },
    { type: 'tool-call' as const, toolCallId: id, toolName: 'getCompanyWork', input: '{}' },
    { type: 'finish' as const, finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage },
  ] }) }
}
function fixture() {
  let state: Snapshot = seedSnapshot()
  const store = { read: async () => structuredClone(state), write: async (next: Snapshot) => { state = structuredClone(next) }, close: async () => {} }
  const work = new WorkService(store, 120000)
  return { store, work, chat: chatHandler(work, { key: 'test-key', model: 'test-model', timezone: 'Asia/Kolkata' }) }
}
it('requests approval before saving an AI task and recovers the approved task on replay', async () => {
  const { chat, store } = fixture()
  provider.model = new MockLanguageModelV3({ doStream: [
    currentWorkStep('initial-work'),
    { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'createTask', input: JSON.stringify(input) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] }) },
    { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Saved and assigned to Leena.' }, { type: 'text-end', id: 'text' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ] }) },
  ] })
  const body = { id: 'test-chat', messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Prepare installation report by December 1, 2030, estimated 4 hours.' }] }] }
  expect(await (await chat(body)).text()).toContain('tool-approval-request')
  expect(JSON.stringify((provider.model as MockLanguageModelV3).doStreamCalls[0].prompt)).toContain('Itron')
  expect(JSON.stringify((provider.model as MockLanguageModelV3).doStreamCalls[0].prompt)).toContain('Itron is the business')
  const pending = await store.read()
  expect(pending.tasks.filter(t => t.actionKey === 'test-chat:user-1')).toHaveLength(0)
  const proposal = (pending.chats[0].messages[1] as import('ai').UIMessage).parts.find(part => part.type === 'tool-createTask') as import('ai').ToolUIPart
  expect(proposal.state).toBe('approval-requested')
  const work = new WorkService(store, 120000)
  await expect(chat({ id: 'test-chat', messages: [{ id: 'another', role: 'user', parts: [{ type: 'text', text: 'Who has capacity?' }] }] })).rejects.toThrow('Approve or reject')
  await work.approveTask('test-chat', proposal.approval!.id, true)
  await work.approveTask('test-chat', proposal.approval!.id, true)
  const state = await store.read()
  expect(state.tasks.filter(t => t.actionKey === 'test-chat:user-1')).toHaveLength(1)
  expect(state.tasks.find(t => t.actionKey === 'test-chat:user-1')?.ownerId).toBe('leena')
  expect(state.chats[0].messages).toHaveLength(2)
  expect(await (await chat(body)).text()).toContain('Itron installation report')
  expect((await store.read()).tasks.filter(t => t.actionKey === 'test-chat:user-1')).toHaveLength(1)

})
it('does not persist a failed assistant response so retry can rerun the pending user turn', async () => {
  const { chat, store } = fixture()
  provider.model = new MockLanguageModelV3({ doStream: { stream: simulateReadableStream({ chunks: [
    { type: 'stream-start', warnings: [] }, { type: 'error', error: new Error('Provider unavailable') },
  ] }) } })
  await (await chat({ id: 'failed-chat', messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Who has capacity?' }] }] })).text()
  expect((await store.read()).chats[0].messages).toHaveLength(1)
})

it('persists uploaded files and passes their content to the model with the text question', async () => {
  const { chat, store } = fixture()
  const model = new MockLanguageModelV3({ doStream: { stream: simulateReadableStream({ chunks: [
    { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: 'Here is the demo installation context.' }, { type: 'text-end', id: 'text' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
  ] }) } })
  provider.model = model
  const file = { type: 'file', mediaType: 'application/pdf', filename: 'itron-handover.pdf', url: 'data:application/pdf;base64,YWJj' }
  await (await chat({ id: 'attachment-chat', messages: [{ id: 'attachment-user', role: 'user', parts: [{ type: 'text', text: 'Summarize this demo handover.' }, file] }] })).text()
  expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain('application/pdf')
  expect(JSON.stringify((await store.read()).chats[0].messages)).toContain('itron-handover.pdf')
})
it('rejects unsupported attachments before persisting chat or calling the provider', async () => {
  const { chat, store } = fixture()
  await expect(chat({ id: 'bad-files', messages: [{ id: 'bad', role: 'user', parts: [{ type: 'text', text: 'Read this.' }, { type: 'file', mediaType: 'image/png', url: 'https://example.com/meter.png' }] }] })).rejects.toThrow('inline')
  expect((await store.read()).chats).toHaveLength(0)
})

it.each([true, false])('continues the chat using authoritative history after approval=%s', async approved => {
  const { chat, store, work } = fixture()
  const model = new MockLanguageModelV3({ doStream: [
    currentWorkStep('initial-work'),
    { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'pending-call', toolName: 'createTask', input: JSON.stringify(input) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] }) },
    currentWorkStep('continued-work'),
    { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'answer' },
      { type: 'text-delta', id: 'answer', delta: 'Here is the current work.' }, { type: 'text-end', id: 'answer' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ] }) },
  ] })
  provider.model = model
  await (await chat({ id: 'continue-chat', messages: [{ id: 'request', role: 'user', parts: [{ type: 'text', text: 'Create an Itron installation report by December 1, 2030, estimated 4 hours.' }] }] })).text()
  const stored = await store.read()
  const part = (stored.chats[0].messages[1] as import('ai').UIMessage).parts.find(p => p.type === 'tool-createTask') as import('ai').ToolUIPart
  await work.approveTask('continue-chat', part.approval!.id, approved)
  expect(await (await chat({ id: 'continue-chat', messages: [{ id: 'next', role: 'user', parts: [{ type: 'text', text: 'What is the current work?' }] }] })).text()).toContain('Here is the current work')
  expect((await store.read()).tasks.filter(task => task.actionKey === 'continue-chat:request')).toHaveLength(approved ? 1 : 0)
})

it('refreshes company facts before answering instead of trusting an earlier task snapshot', async () => {
  const { chat, store } = fixture()
  const state = await store.read()
  const staleTask = structuredClone(state.tasks[0])
  staleTask.status = 'accepted'; staleTask.blockerText = ''
  state.tasks[0].status = 'blocked'
  state.tasks[0].blockerText = 'Fresh audit blocker: waiting for the bench fixture.'
  state.chats.push({ id: 'fresh-status', updatedAt: new Date().toISOString(), messages: [
    { id: 'earlier-user', role: 'user', parts: [{ type: 'text', text: 'What is the task status?' }] },
    { id: 'earlier-assistant', role: 'assistant', parts: [{ type: 'tool-getCompanyWork', toolCallId: 'old-read', state: 'output-available', input: {}, output: { employees: [], tasks: [staleTask], updates: [] } }] },
  ] })
  await store.write(state)
  provider.model = new MockLanguageModelV3({ doStream: async options => {
    const choice = options.toolChoice
    if (choice?.type === 'tool' && choice.toolName === 'getCompanyWork') return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'fresh-read', toolName: 'getCompanyWork', input: '{}' },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage },
    ] }) }
    const answer = JSON.stringify(options.prompt).includes('Fresh audit blocker') ? 'Fresh audit blocker: waiting for the bench fixture.' : 'There are no blockers.'
    return { stream: simulateReadableStream({ chunks: [
      { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'fresh-answer' },
      { type: 'text-delta', id: 'fresh-answer', delta: answer }, { type: 'text-end', id: 'fresh-answer' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
    ] }) }
  } })
  const response = await (await chat({ id: 'fresh-status', messages: [{ id: 'latest-user', role: 'user', parts: [{ type: 'text', text: 'What is blocking that task now?' }] }] })).text()
  expect(response).toContain('Fresh audit blocker')
  expect((await store.read()).tasks).toEqual(state.tasks)
})
