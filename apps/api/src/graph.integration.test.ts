import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GraphStore } from './graph.js'
import { WorkService } from './work.js'
import { FalkorDB } from 'falkordb'

const enabled = process.env.RUN_GRAPH_TESTS === '1'
describe.skipIf(!enabled)('real FalkorDB persistence', () => {
  it('persists task approval, reply, follow-up and completion across fresh connections', async () => {
    const graph = `company_brain_test_${randomUUID().replaceAll('-', '')}`
    const options = { host: '127.0.0.1', port: Number(process.env.FALKORDB_PORT || 16379), graph, password: undefined }
    let now = new Date('2030-11-01T09:00:00Z')
    let store = new GraphStore(options)
    try {
      const initial = await store.read(); expect(initial.employees).toHaveLength(6)
      let work = new WorkService(store, 120000, () => now)
      await work.mutate(state => state.chats.push({ id: 'test', updatedAt: now.toISOString(), messages: [
        { id: 'request', role: 'user', parts: [{ type: 'text', text: 'Create an Itron installation report.' }] },
        { id: 'proposal', role: 'assistant', parts: [{ type: 'tool-createTask', toolCallId: 'call', state: 'approval-requested', input: { title: 'Itron installation report', description: 'Prepare Itron meter delivery and gateway readiness.', requiredResponsibility: 'installation', dueAt: '2030-11-05T12:00:00Z', effortHours: 4 }, approval: { id: 'approve-test' } }] },
      ] }))
      await store.close()
      store = new GraphStore(options)
      expect(JSON.stringify((await store.read()).chats)).toContain('approval-requested')
      expect((await store.read()).tasks.some(t => t.actionKey === 'test:request')).toBe(false)
      work = new WorkService(store, 120000, () => now)
      await work.approveTask('test', 'approve-test', true)
      await work.approveTask('test', 'approve-test', true)
      const task = (await store.read()).tasks.find(t => t.actionKey === 'test:request')!
      expect(task.ownerId).toBe('leena')
      await work.respond(task.id, 'leena', 'accept', '', 'accept')
      await work.respond(task.id, 'leena', 'blocked', 'Waiting for finance figures.', 'block')
      now = new Date(now.getTime() + 120000)
      expect(await work.checkFollowUps()).toBe(1)
      await store.close()
      store = new GraphStore(options)
      const restored = await store.read()
      expect(restored.tasks.find(t => t.id === task.id)?.blockerText).toBe('Waiting for finance figures.')
      expect(restored.messages.some(m => m.taskId === task.id && m.kind === 'follow-up')).toBe(true)
      const restoredWork = new WorkService(store, 120000, () => now)
      await restoredWork.respond(task.id, 'leena', 'complete', '', 'done')
      now = new Date(now.getTime() + 120000)
      expect(await restoredWork.checkFollowUps()).toBe(0)
      await store.close()
      store = new GraphStore(options)
      expect((await store.read()).tasks.find(t => t.id === task.id)?.status).toBe('completed')
    } finally {
      await store.close()
      const cleanup = await FalkorDB.connect({ socket: { host: options.host, port: options.port } })
      await cleanup.selectGraph(graph).delete(); await cleanup.close()
    }
  })
})
