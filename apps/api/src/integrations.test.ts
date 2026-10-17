import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MicrosoftConnections, integrationRoutes } from './integrations.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'brain-microsoft-')); directories.push(directory)
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: 'secret-access-token', refresh_token: 'secret-refresh-token', expires_in: 3600, scope: 'User.Read Mail.Read Calendars.Read' })).mockResolvedValueOnce(Response.json({ displayName: 'Maya Sharma', mail: 'maya@example.com', userPrincipalName: 'maya@example.com' }))
  let now = 1000
  const settings = { clientId: 'client', clientSecret: 'secret', tenant: 'organizations', redirectUri: 'http://localhost:5173/api/integrations/microsoft/callback', frontend: 'http://localhost:5173', key: Buffer.alloc(32, 1).toString('base64'), directory }
  const service = new MicrosoftConnections(settings, fetcher, () => now)
  return { service, settings, fetcher, advance: () => { now += 11 * 60_000 } }
}
describe('Microsoft account connections', () => {
  it('uses PKCE, validates Microsoft identity, and stores encrypted credentials across restart', async () => {
    const { service, settings, fetcher } = await fixture()
    const url = new URL(service.begin('outlook', 'browser'))
    expect(url.hostname).toBe('login.microsoftonline.com')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(await service.complete(url.searchParams.get('state')!, 'browser', 'code')).toBe('outlook')
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain('code_verifier=')
    const saved = await readFile(join(settings.directory, 'outlook.json'), 'utf8')
    expect(saved).not.toContain('secret-access-token'); expect(saved).not.toContain('secret-refresh-token')
    const restarted = new MicrosoftConnections(settings)
    const statuses = await restarted.statuses()
    expect(statuses.find(status => status.id === 'outlook')).toMatchObject({ connected: true, account: { email: 'maya@example.com' } })
    expect(JSON.stringify(statuses)).not.toContain('secret-access-token')
    await restarted.disconnect('outlook')
    expect((await restarted.statuses())[0].connected).toBe(false)
  })
  it('rejects wrong-browser, expired, and replayed callbacks', async () => {
    const { service, advance, fetcher } = await fixture()
    const state = new URL(service.begin('outlook', 'browser')).searchParams.get('state')!
    await expect(service.complete(state, 'other-browser', 'code')).rejects.toThrow('expired')
    expect(fetcher).not.toHaveBeenCalled()
    await service.complete(state, 'browser', 'code')
    await expect(service.complete(state, 'browser', 'code')).rejects.toThrow('expired')
    const expired = new URL(service.begin('teams', 'browser')).searchParams.get('state')!
    advance(); await expect(service.complete(expired, 'browser', 'code')).rejects.toThrow('expired')
  })
  it('does not mark connections successful when consent or token exchange fails', async () => {
    const { service, fetcher } = await fixture()
    fetcher.mockReset().mockResolvedValue(Response.json({ access_token: 'token', scope: 'User.Read', expires_in: 3600 }))
    const state = new URL(service.begin('outlook', 'browser')).searchParams.get('state')!
    await expect(service.complete(state, 'browser', 'code')).rejects.toThrow('permissions')
    expect((await service.statuses())[0].connected).toBe(false)
  })
  it('reports missing setup and rejects unknown providers', async () => {
    const { settings } = await fixture()
    const app = integrationRoutes(new MicrosoftConnections({ ...settings, clientId: '' }))
    expect(await (await app.request('/')).json()).toMatchObject([{ id: 'outlook', configured: false, connected: false }, { id: 'teams', configured: false, connected: false }])
    expect((await app.request('/outlook/connect', { method: 'POST' })).status).toBe(503)
    expect((await app.request('/unknown/connect', { method: 'POST' })).status).toBe(404)
  })
  it('binds callbacks to an HttpOnly browser cookie and returns safe failure redirects', async () => {
    const { service } = await fixture(); const app = integrationRoutes(service)
    const begin = await app.request('/teams/connect', { method: 'POST', headers: { origin: 'http://localhost:5173' } })
    expect(begin.headers.get('set-cookie')).toContain('HttpOnly')
    const response = await app.request('/microsoft/callback?state=invalid&code=code')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/integrations?error=')
    expect((await app.request('/teams/connect', { method: 'POST', headers: { origin: 'http://127.0.0.1:5173' } })).status).toBe(400)
  })
  it('completes Teams callbacks separately and handles denied consent without saving', async () => {
    const { service, fetcher } = await fixture()
    fetcher.mockReset().mockResolvedValueOnce(Response.json({ access_token: 'teams-token', refresh_token: 'teams-refresh', expires_in: 3600, scope: 'User.Read Team.ReadBasic.All Channel.ReadBasic.All Chat.Read ChatMessage.Send' })).mockResolvedValueOnce(Response.json({ displayName: 'Maya', mail: 'maya@example.com' }))
    const app = integrationRoutes(service)
    const begin = await app.request('/teams/connect', { method: 'POST' })
    const { url } = await begin.json() as { url: string }
    const state = new URL(url).searchParams.get('state')!
    const cookie = begin.headers.get('set-cookie')!.split(';')[0]
    const callback = await app.request(`/microsoft/callback?state=${state}&code=code`, { headers: { cookie } })
    expect(callback.headers.get('location')).toContain('connected=teams')
    expect((await service.statuses()).map(status => status.connected)).toEqual([false, true])
    const cancelled = await app.request('/outlook/connect', { method: 'POST' })
    const cancelledUrl = new URL((await cancelled.json() as { url: string }).url)
    const denied = await app.request(`/microsoft/callback?state=${cancelledUrl.searchParams.get('state')}&error=access_denied`, { headers: { cookie: cancelled.headers.get('set-cookie')!.split(';')[0] } })
    expect(denied.headers.get('location')).toContain('error=')
    expect((await service.statuses())[0].connected).toBe(false)
  })
})
