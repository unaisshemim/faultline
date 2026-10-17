import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { IntegrationId, IntegrationStatus } from '../../../shared/contracts.js'
import { teamsRoutes } from './teams.js'

const scopes = {
  outlook: ['User.Read', 'Mail.Read', 'Calendars.Read'],
  teams: ['User.Read', 'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'Chat.Read', 'ChatMessage.Send'],
}
const hasScopes = (granted: string, required: string[]) => required.every(scope => granted.split(' ').some(value => value.toLowerCase().replace('https://graph.microsoft.com/', '') === scope.toLowerCase()))
export class MicrosoftError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 409 | 429 | 502, readonly code = 'microsoft_error') { super(message) }
}
interface Connection { accessToken: string; refreshToken: string; expiresAt: number; scopes: string; account: { id?: string; name: string; email: string }; connectedAt: string }
interface Settings { clientId: string; clientSecret: string; tenant: string; redirectUri: string; frontend: string; key: string; directory: string }
interface Pending { provider: IntegrationId; verifier: string; browser: string; expires: number }
const isProvider = (value: string): value is IntegrationId => value === 'outlook' || value === 'teams'
const cookieName = 'company_brain_microsoft'

export function integrationSettings(): Settings {
  return { clientId: process.env.MICROSOFT_CLIENT_ID || '', clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '', tenant: process.env.MICROSOFT_TENANT_ID || 'organizations', redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:5173/api/integrations/microsoft/callback', frontend: process.env.APP_URL || 'http://localhost:5173', key: process.env.MICROSOFT_TOKEN_KEY || '', directory: resolve(process.cwd(), '../../data/microsoft') }
}
export class MicrosoftConnections {
  private pending = new Map<string, Pending>()
  private refreshing = new Map<IntegrationId, Promise<Connection>>()
  constructor(readonly settings = integrationSettings(), private fetcher: typeof fetch = fetch, private now = () => Date.now()) {}
  get configured() { return Boolean(this.settings.clientId && this.settings.clientSecret && Buffer.from(this.settings.key, 'base64').length === 32 && /^[a-zA-Z0-9.-]+$/.test(this.settings.tenant)) }
  private endpoint(kind: 'authorize' | 'token') { return `https://login.microsoftonline.com/${this.settings.tenant}/oauth2/v2.0/${kind}` }
  private path(provider: IntegrationId) { return resolve(this.settings.directory, `${provider}.json`) }
  private async read(provider: IntegrationId): Promise<Connection | null> {
    let content: string
    try { content = await readFile(this.path(provider), 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    const { iv, tag, data } = JSON.parse(content)
    const cipher = createDecipheriv('aes-256-gcm', Buffer.from(this.settings.key, 'base64'), Buffer.from(iv, 'base64'))
    cipher.setAuthTag(Buffer.from(tag, 'base64'))
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString())
  }
  private async save(provider: IntegrationId, connection: Connection) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(this.settings.key, 'base64'), iv)
    const data = Buffer.concat([cipher.update(JSON.stringify(connection)), cipher.final()])
    await mkdir(this.settings.directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.path(provider)}.${randomBytes(8).toString('hex')}.tmp`
    await writeFile(temporary, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 })
    await rename(temporary, this.path(provider))
  }
  async statuses(): Promise<IntegrationStatus[]> {
    return Promise.all((['outlook', 'teams'] as const).map(async id => {
      const connection = this.configured ? await this.read(id) : null
      return { id, configured: this.configured, connected: Boolean(connection && (connection.expiresAt > this.now() || connection.refreshToken)), account: connection?.account ?? null, connectedAt: connection?.connectedAt ?? null, needsReconnect: Boolean(connection && !hasScopes(connection.scopes, scopes[id])) }
    }))
  }
  begin(provider: IntegrationId, browser: string) {
    if (!this.configured) throw new Error('Microsoft sign-in is not configured for this workspace.')
    for (const [id, request] of this.pending) if (request.expires < this.now()) this.pending.delete(id)
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    this.pending.set(state, { provider, verifier, browser, expires: this.now() + 10 * 60_000 })
    const params = new URLSearchParams({ client_id: this.settings.clientId, response_type: 'code', redirect_uri: this.settings.redirectUri, response_mode: 'query', scope: ['offline_access', ...scopes[provider]].join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'select_account' })
    return `${this.endpoint('authorize')}?${params}`
  }
  private consume(state: string, browser: string) {
    const pending = this.pending.get(state)
    if (!pending || pending.browser !== browser || pending.expires < this.now()) throw new Error('Connection request expired. Please try connecting again.')
    this.pending.delete(state)
    return pending
  }
  cancel(state: string, browser: string) { this.consume(state, browser) }
  async complete(state: string, browser: string, code: string) {
    const pending = this.consume(state, browser)
    if (!code) throw new Error('Microsoft did not return an authorization code.')
    const response = await this.fetcher(this.endpoint('token'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.settings.clientId, client_secret: this.settings.clientSecret, grant_type: 'authorization_code', code, redirect_uri: this.settings.redirectUri, code_verifier: pending.verifier }), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Microsoft could not complete the connection. Please try again.')
    const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in: number; scope?: string }
    if (!tokens.access_token || !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 0 || !tokens.scope || !hasScopes(tokens.scope, scopes[pending.provider])) throw new Error('Microsoft did not grant all required permissions. Please try again.')
    const profile = await this.fetcher('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000) })
    if (!profile.ok) throw new Error('Could not verify your Microsoft account. Please try again.')
    const account = await profile.json() as { id?: string; displayName: string; mail: string | null; userPrincipalName: string }
    if (!account.displayName || !(account.mail || account.userPrincipalName)) throw new Error('Could not verify your Microsoft account. Please try again.')
    await this.save(pending.provider, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || '', expiresAt: this.now() + Number(tokens.expires_in) * 1000, scopes: tokens.scope, account: { id: account.id, name: account.displayName, email: account.mail || account.userPrincipalName }, connectedAt: new Date(this.now()).toISOString() })
    return pending.provider
  }
  private async access(provider: IntegrationId, required: string[]): Promise<Connection> {
    const connection = this.configured ? await this.read(provider) : null
    if (!connection) throw new MicrosoftError('Connect Microsoft Teams from Integrations first.', 401, 'reconnect_required')
    if (!hasScopes(connection.scopes, required)) throw new MicrosoftError('Reconnect Teams from Integrations to approve chat reading and sending permissions.', 403, 'reconnect_required')
    if (connection.expiresAt > this.now() + 60_000) return connection
    if (!connection.refreshToken) throw new MicrosoftError('Your Microsoft session expired. Reconnect Teams.', 401, 'reconnect_required')
    let pending = this.refreshing.get(provider)
    if (!pending) {
      pending = (async () => {
        const response = await this.fetcher(this.endpoint('token'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.settings.clientId, client_secret: this.settings.clientSecret, grant_type: 'refresh_token', refresh_token: connection.refreshToken, scope: ['offline_access', ...scopes[provider]].join(' ') }), signal: AbortSignal.timeout(15_000) })
        if (!response.ok) throw new MicrosoftError('Microsoft could not renew your session. Reconnect Teams.', 401, 'reconnect_required')
        const tokens = await response.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string }
        if (!tokens.access_token || !Number.isFinite(Number(tokens.expires_in)) || Number(tokens.expires_in) <= 0) throw new MicrosoftError('Microsoft could not renew your session. Reconnect Teams.', 401, 'reconnect_required')
        const refreshed = { ...connection, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || connection.refreshToken, expiresAt: this.now() + Number(tokens.expires_in) * 1000, scopes: tokens.scope || connection.scopes }
        if (!hasScopes(refreshed.scopes, required)) throw new MicrosoftError('Reconnect Teams to approve the required permissions.', 403, 'reconnect_required')
        const current = await this.read(provider)
        if (!current || current.connectedAt !== connection.connectedAt) throw new MicrosoftError('Your Microsoft connection changed. Reload this page.', 401, 'reconnect_required')
        await this.save(provider, refreshed)
        return refreshed
      })().finally(() => this.refreshing.delete(provider))
      this.refreshing.set(provider, pending)
    }
    const refreshed = await pending
    if (!hasScopes(refreshed.scopes, required)) throw new MicrosoftError('Reconnect Teams to approve the required permissions.', 403, 'reconnect_required')
    return refreshed
  }
  async graph<T>(path: string, required: string[], body?: unknown): Promise<T> {
    const url = new URL(path, 'https://graph.microsoft.com')
    if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/')) throw new MicrosoftError('Invalid Microsoft Graph request.', 400)
    const connection = await this.access('teams', required)
    let response: Response
    try {
      response = await this.fetcher(url.toString(), { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${connection.accessToken}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000), redirect: 'error' })
    } catch { throw new MicrosoftError(body === undefined ? 'Could not reach Microsoft Teams. Please try again.' : 'Delivery could not be confirmed. Refresh the conversation before sending again.', 502, body === undefined ? 'network_error' : 'delivery_unknown') }
    if (response.status === 401) throw new MicrosoftError('Your Microsoft connection is no longer valid. Reconnect Teams.', 401, 'reconnect_required')
    if (response.status === 403) throw new MicrosoftError('Microsoft denied chat access. Reconnect Teams and approve the permissions; your organization may require admin consent.', 403, 'reconnect_required')
    if (response.status === 429) throw new MicrosoftError('Microsoft is limiting requests. Wait a moment, then try again.', 429)
    if (!response.ok) throw new MicrosoftError(body === undefined ? 'Microsoft could not load this conversation. Please try again.' : response.status >= 500 ? 'Delivery could not be confirmed. Refresh the conversation before sending again.' : 'Microsoft could not send this message. Check the conversation and try again.', 502, body !== undefined && response.status >= 500 ? 'delivery_unknown' : 'microsoft_error')
    return response.json() as Promise<T>
  }
  async disconnect(provider: IntegrationId) {
    for (const [state, pending] of this.pending) if (pending.provider === provider) this.pending.delete(state)
    try { await unlink(this.path(provider)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}

export function integrationRoutes(service = new MicrosoftConnections()) {
  const app = new Hono()
  app.onError((_error, c) => c.json({ error: 'Could not load or save Microsoft connections. Check the workspace configuration and try again.' }, 503))
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.get('/', async c => c.json(await service.statuses()))
  app.route('/teams', teamsRoutes(service))
  app.post('/:provider/connect', c => {
    const provider = c.req.param('provider')
    if (!isProvider(provider)) return c.json({ error: 'Unknown integration.' }, 404)
    if (!service.configured) return c.json({ error: 'Microsoft sign-in is not configured for this workspace.' }, 503)
    // The callback must use the same host as the browser that receives this cookie.
    const origin = c.req.header('origin')
    if (origin && new URL(service.settings.redirectUri).origin !== origin) return c.json({ error: `Open this workspace at ${service.settings.frontend} to connect Microsoft.` }, 400)
    const browser = randomBytes(32).toString('base64url')
    setCookie(c, cookieName, browser, { httpOnly: true, sameSite: 'Lax', secure: service.settings.redirectUri.startsWith('https:'), path: '/api/integrations', maxAge: 600 })
    return c.json({ url: service.begin(provider, browser) })
  })
  app.get('/microsoft/callback', async c => {
    const browser = getCookie(c, cookieName) || ''
    deleteCookie(c, cookieName, { path: '/api/integrations' })
    const result = new URL(service.settings.frontend)
    const params = new URLSearchParams()
    try {
      if (c.req.query('error')) { service.cancel(c.req.query('state') || '', browser); throw new Error('Microsoft sign-in was cancelled or permission was denied. Please try again.') }
      const provider = await service.complete(c.req.query('state') || '', browser, c.req.query('code') || '')
      params.set('connected', provider)
    } catch (error) { params.set('error', error instanceof Error ? error.message : 'Could not connect to Microsoft. Please try again.') }
    result.hash = `/integrations?${params}`
    return c.redirect(result.toString())
  })
  app.post('/:provider/disconnect', async c => {
    const provider = c.req.param('provider')
    if (!isProvider(provider)) return c.json({ error: 'Unknown integration.' }, 404)
    await service.disconnect(provider)
    return c.json({ disconnected: true })
  })
  return app
}
