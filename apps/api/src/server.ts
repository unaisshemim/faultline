import { config } from 'dotenv'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { GraphStore } from './graph.js'
import { WorkService } from './work.js'
import { createApp } from './app.js'

config({ path: resolve(process.cwd(), '../../.env'), quiet: true })
const store = new GraphStore()
const intervalMs = Math.max(10_000, Number(process.env.FOLLOW_UP_INTERVAL_MS) || 120_000)
const work = new WorkService(store, intervalMs)
const app = createApp(work)
const server = serve({ fetch: app.fetch, port: Number(process.env.API_PORT) || 3101, hostname: '127.0.0.1' }, info => console.log(`Company Brain API: http://localhost:${info.port}`))
let ticking = false
const timer = setInterval(async () => { if (ticking) return; ticking = true; try { await work.checkFollowUps() } catch (error) { console.error('Follow-up check failed:', error instanceof Error ? error.message : 'database unavailable') } finally { ticking = false } }, 30_000)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); server.close(() => { void store.close().finally(() => process.exit(0)) }) })
void store.read().then(() => console.log('FalkorDB connected; sample company ready.')).catch(() => console.log('FalkorDB is unavailable; read-only preview will be shown.'))
