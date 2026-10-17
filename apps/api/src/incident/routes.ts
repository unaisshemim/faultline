import { Hono } from 'hono'
import { z } from 'zod'
import { serviceNames } from '../../../../shared/incident.js'
import { IncidentEngine, IncidentError } from './engine.js'
import { FalkorIncidentGraph, type IncidentGraph } from './graph.js'

export function createIncidentRoutes(graph: IncidentGraph = new FalkorIncidentGraph(), config = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4.1-mini' }) {
  const app = new Hono()
  const engine = new IncidentEngine(graph, config)
  engine.bind(async (service, headers, signal) => app.request(`/services/${service}?sku=DEMO-001&quantity=1`, { headers, signal }))
  app.onError((error, c) => {
    if (error instanceof IncidentError) return c.json({ error: error.message }, error.status)
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'Invalid sandbox request.' }, 400)
    console.error('Incident sandbox operation failed:', error instanceof Error ? error.message : 'unknown error')
    return c.json({ error: 'The sandbox operation failed. Check the local FalkorDB connection, then retry.' }, 503)
  })
  app.route('/mcp', engine.mcp)
  app.get('/status', c => c.json(engine.snapshot()))
  app.post('/start', async c => {
    const { fault } = z.object({ fault: z.enum(['product-data', 'payments']) }).strict().parse(await c.req.json())
    return c.json(await engine.start(fault))
  })
  app.post('/investigate', async c => {
    const input = z.object({ runId: z.string().uuid(), engine: z.enum(['auto', 'deterministic']).default('auto') }).strict().parse(await c.req.json())
    return c.json(await engine.investigate(input.runId, input.engine === 'auto'))
  })
  app.post('/rollback', async c => {
    const input = z.object({ runId: z.string().uuid(), approvalId: z.string().uuid() }).strict().parse(await c.req.json())
    return c.json(await engine.rollback(input.runId, input.approvalId))
  })
  app.post('/check', async c => {
    const { runId } = z.object({ runId: z.string().uuid() }).strict().parse(await c.req.json())
    return c.json(await engine.check(runId))
  })
  app.get('/services/:name', async c => engine.service(z.enum(serviceNames).parse(c.req.param('name')), c.req.raw))
  return { app, engine }
}
