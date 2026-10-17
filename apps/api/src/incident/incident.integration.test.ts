import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { FalkorDB } from 'falkordb'
import type { IncidentSnapshot } from '../../../../shared/incident.js'
import { FalkorIncidentGraph } from './graph.js'
import { createIncidentRoutes } from './routes.js'

const enabled = process.env.RUN_GRAPH_TESTS === '1'
describe.skipIf(!enabled)('executable incident investigation against real FalkorDB', () => {
  it('uses graph evidence for both fault locations and verifies both approved fixes', async () => {
    const name = `incident_test_${randomUUID().replaceAll('-', '')}`
    const graph = new FalkorIncidentGraph(name)
    const { app } = createIncidentRoutes(graph, { model: 'test-model' })
    const post = async (path: string, body: unknown) => {
      const response = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const value = await response.json()
      expect(response.status, JSON.stringify(value)).toBe(200)
      return value as IncidentSnapshot
    }
    try {
      let edges: IncidentSnapshot['edges'] | undefined
      for (const fault of ['product-data', 'payments'] as const) {
        const fired = await post('/start', { fault })
        expect(fired.run!.alerts).toHaveLength(5)
        if (edges) expect(fired.edges).toEqual(edges)
        edges = fired.edges
        const diagnosis = await post('/investigate', { runId: fired.run!.id, engine: 'deterministic' })
        expect(diagnosis.run!.diagnosis!.rootCause).toBe(fault)
        expect(diagnosis.run!.queries.some(query => query.cypher.includes('DEPENDS_ON*1..4') && query.rowCount === 5)).toBe(true)
        expect(diagnosis.run!.queries.some(query => query.tool === 'read_trace_evidence' && query.rowCount > 4)).toBe(true)
        if (fault === 'product-data') {
          expect(diagnosis.run!.queries.find(query => query.tool === 'find_convergence')?.rowCount).toBe(1)
          expect(diagnosis.run!.diagnosis!.paths).toHaveLength(2)
          expect(diagnosis.run!.diagnosis!.eliminated[0].service).toBe('payments')
        } else expect(diagnosis.run!.diagnosis!.paths).toEqual([['checkout', 'payments']])
        expect((await graph.traces(fired.run!.id)).some(span => span.service === fault && span.errorCode === 'TIMEOUT')).toBe(true)
        const fixed = await post('/rollback', { runId: fired.run!.id, approvalId: diagnosis.run!.approval!.id })
        expect(fixed.run!.state).toBe('recovered')
        expect(fixed.run!.before.status).toBe(503)
        expect(fixed.run!.verification!.status).toBe(200)
        expect(fixed.run!.before.request).toBe(fixed.run!.verification!.request)
        expect(fixed.services.every(service => service.status === 'healthy')).toBe(true)
        expect((await app.request('/services/checkout?sku=DEMO-001&quantity=1')).status).toBe(200)
      }
    } finally {
      await graph.close()
      const db = await FalkorDB.connect({ socket: { host: process.env.FALKORDB_HOST || '127.0.0.1', port: Number(process.env.FALKORDB_PORT || 16379) }, password: process.env.FALKORDB_PASSWORD })
      try { await db.selectGraph(name).delete() } finally { await db.close() }
    }
  })
})
