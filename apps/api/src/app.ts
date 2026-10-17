import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { WorkService, WorkError } from './work.js'
import { seedSnapshot } from './seed.js'
import { chatHandler } from './chat.js'
import { createIncidentRoutes } from './incident/routes.js'
import { integrationRoutes } from './integrations.js'
import type { SystemStatus } from '../../../shared/contracts.js'

export function createApp(work: WorkService, config = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', timezone: process.env.COMPANY_TIMEZONE || 'Asia/Kolkata' }) {
  const app = new Hono()
  app.use('/api/*', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: c => c.json({ error: 'Request is too large.' }, 413) }))
  // The unauthenticated demo is localhost-only. Reject cross-site browser mutations.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET') {
      const origin = c.req.header('origin')
      const allowed = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3101', 'http://127.0.0.1:3101'])
      if (origin && !allowed.has(origin)) return c.json({ error: 'This local demo does not allow requests from that origin.' }, 403)
      if (!c.req.header('content-type')?.includes('application/json')) return c.json({ error: 'Use application/json.' }, 415)
    }
    await next()
  })
  const status = (database: boolean): SystemStatus => ({ database, openai: Boolean(config.key), model: config.model, timezone: config.timezone, followUpIntervalMs: work.followUpIntervalMs, preview: !database })
  app.route('/api/incident', createIncidentRoutes(undefined, config).app)
  app.route('/api/integrations', integrationRoutes())
  app.get('/api/health', async c => {
    try { await work.store.read(); return c.json(status(true)) } catch { return c.json(status(false)) }
  })
  app.get('/api/dashboard', async c => {
    try { return c.json(await work.data(status(true))) } catch { return c.json(work.toWorkData(seedSnapshot(), status(false))) }
  })
  app.get('/api/employees', async c => c.json((await work.data(status(true))).employees))
  app.get('/api/tasks', async c => c.json((await work.store.read()).tasks))
  app.get('/api/tasks/:id', async c => {
    const state = await work.store.read(); const task = state.tasks.find(t => t.id === c.req.param('id'))
    if (!task) throw new WorkError('Task not found.', 404)
    return c.json({ task, updates: state.updates.filter(u => u.taskId === task.id), messages: state.messages.filter(m => m.taskId === task.id) })
  })
  app.post('/api/tasks/:id/respond', async c => {
    const input = z.object({ employeeId: z.string().min(1), action: z.enum(['accept', 'decline', 'clarify', 'progress', 'blocked', 'complete']), text: z.string().max(4000).default(''), requestId: z.string().min(1).max(100) }).parse(await c.req.json())
    return c.json(await work.respond(c.req.param('id'), input.employeeId, input.action, input.text, input.requestId))
  })
  app.post('/api/tasks/:id/cancel', async c => c.json(await work.cancel(c.req.param('id'))))
  app.get('/api/chats', async c => {
    const state = await work.store.read()
    return c.json(state.chats.map(chat => {
      const messages = chat.messages as import('ai').UIMessage[]
      const first = messages.find(message => message.role === 'user')
      const title = first?.parts.filter(part => part.type === 'text').map(part => part.text).join(' ').slice(0, 120) || 'Itron conversation'
      return { id: chat.id, title, updatedAt: chat.updatedAt, messageCount: messages.length }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  })
  app.post('/api/chat/:id/approval', async c => {
    const input = z.object({ approvalId: z.string().min(1).max(200), approved: z.boolean() }).strict().parse(await c.req.json())
    return c.json(await work.approveTask(c.req.param('id'), input.approvalId, input.approved))
  })
  app.get('/api/chat/:id', async c => c.json((await work.store.read()).chats.find(chat => chat.id === c.req.param('id'))?.messages ?? []))
  const chat = chatHandler(work, config)
  app.post('/api/chat', async c => chat(await c.req.json()))
  app.onError((error, c) => {
    if (error instanceof WorkError) return c.json({ error: error.message }, error.status)
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'Some information is missing or invalid. Please check the request.' }, 400)
    console.error('API error:', error.message)
    return c.json({ error: 'Could not save or load company data. Check the FalkorDB connection and try again.' }, 503)
  })
  return app
}
