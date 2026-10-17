import { Hono } from 'hono'
import { z } from 'zod'
import { serviceNames } from '../../../../shared/incident.js'
import type { IncidentGraph } from './graph.js'

export const incidentToolDefinitions = [
  { name: 'trace_dependencies', description: 'Traverse the real FalkorDB dependency graph from a service. Returns all downstream paths, not a guessed topology.', inputSchema: { type: 'object', properties: { root: { type: 'string', enum: [...serviceNames] } }, required: ['root'], additionalProperties: false } },
  { name: 'read_trace_evidence', description: 'Read the current incident’s actual executable service request spans from FalkorDB, including successes, timeout errors, parent span IDs, and configuration revisions.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'read_recent_changes', description: 'Read configuration and deployment changes recorded before the current incident’s failing request. A recent deployment alone is not proof of a failure.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'find_convergence', description: 'Use a multi-hop Cypher query and branch aggregation to find dependencies shared by multiple failing branches.', inputSchema: { type: 'object', properties: { root: { type: 'string', enum: [...serviceNames] }, branches: { type: 'array', items: { type: 'string', enum: [...serviceNames] } } }, required: ['root', 'branches'], additionalProperties: false } },
]
const rootSchema = z.object({ root: z.enum(serviceNames) }).strict()
const emptySchema = z.object({}).strict()
export function incidentMcp(graph: IncidentGraph, currentRun: () => string | undefined) {
  const app = new Hono()
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin')
    if (origin && !['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3101', 'http://127.0.0.1:3101'].includes(origin)) return c.json({ error: 'Origin is not allowed.' }, 403)
    await next()
  })
  app.get('/', c => c.body(null, 405))
  app.post('/', async c => {
    let body: { jsonrpc: string; id?: string | number | null; method: string; params?: { name?: string; arguments?: unknown; protocolVersion?: string } }
    try { body = await c.req.json() } catch { return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400) }
    const fail = (code: number, message: string) => c.json({ jsonrpc: '2.0', id: body.id ?? null, error: { code, message } })
    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') return fail(-32600, 'Invalid request')
    if (body.id === undefined) return c.body(null, 202)
    const respond = (result: unknown) => c.json({ jsonrpc: '2.0', id: body.id, result })
    if (body.method === 'initialize') return respond({ protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'faultline-sandbox', version: '1.0.0' } })
    if (body.method === 'ping') return respond({})
    if (body.method === 'tools/list') return respond({ tools: incidentToolDefinitions.map(tool => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })) })
    if (body.method !== 'tools/call') return fail(-32601, 'Method not found')
    if (!incidentToolDefinitions.some(tool => tool.name === body.params?.name)) return fail(-32602, 'Unknown tool')
    try {
      const runId = currentRun()
      if (!runId) throw new Error('Trigger a sandbox incident first.')
      const args = body.params?.arguments ?? {}
      let result: unknown
      switch (body.params!.name) {
        case 'trace_dependencies': result = await graph.paths(rootSchema.parse(args).root); break
        case 'read_trace_evidence': emptySchema.parse(args); result = await graph.traces(runId); break
        case 'read_recent_changes': emptySchema.parse(args); result = await graph.changes(runId); break
        case 'find_convergence': {
          const input = rootSchema.extend({ branches: z.array(z.enum(serviceNames)).max(5) }).strict().parse(args)
          result = await graph.convergence(input.root, input.branches); break
        }
      }
      return respond({ content: [{ type: 'text', text: JSON.stringify(result) }] })
    } catch (error) { return respond({ content: [{ type: 'text', text: error instanceof z.ZodError ? 'Invalid tool arguments.' : error instanceof Error ? error.message : 'Graph query failed.' }], isError: true }) }
  })
  return app
}

// The investigator uses the same JSON-RPC wire contract as an external MCP client.
export class IncidentMcpClient {
  private id = 0
  constructor(private server: ReturnType<typeof incidentMcp>) {}
  async request(method: string, params: unknown = {}) {
    const response = await this.server.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }) })
    const body = await response.json() as { result?: { content?: { text: string }[]; isError?: boolean; tools?: typeof incidentToolDefinitions }; error?: { message: string } }
    if (!response.ok || body.error || body.result?.isError) throw new Error(body.error?.message || body.result?.content?.[0]?.text || 'MCP request failed')
    return body.result!
  }
  async discover() {
    await this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'faultline-investigator', version: '1.0.0' } })
    return (await this.request('tools/list')).tools!
  }
  async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.request('tools/call', { name, arguments: args })
    return JSON.parse(result.content![0].text) as T
  }
}
