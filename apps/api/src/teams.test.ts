import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MicrosoftConnections, integrationRoutes } from './integrations.js'

const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))) })
async function fixture(granted = 'User.Read Team.ReadBasic.All Channel.ReadBasic.All Chat.Read ChatMessage.Send') {
  const directory = await mkdtemp(join(tmpdir(), 'brain-teams-')); folders.push(directory)
  let now = Date.now()
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: granted })).mockResolvedValueOnce(Response.json({ id: 'maya', displayName: 'Maya', mail: 'maya@example.com' }))
  const settings = { clientId: 'client', clientSecret: 'secret', tenant: 'organizations', redirectUri: 'http://localhost:5173/api/integrations/microsoft/callback', frontend: 'http://localhost:5173', key: Buffer.alloc(32, 1).toString('base64'), directory }
  const service = new MicrosoftConnections(settings, fetcher, () => now)
  const state = new URL(service.begin('teams', 'browser')).searchParams.get('state')!
  await service.complete(state, 'browser', 'code')
  fetcher.mockReset()
  return { service, app: integrationRoutes(service), fetcher, settings, expire: () => { now += 3600_000 } }
}
describe('Teams chats', () => {
  it('lists chat pages and preserves a continuation for loading every conversation', async () => {
    const { app, fetcher } = await fixture()
    fetcher.mockResolvedValue(Response.json({ value: [{ id: 'chat', chatType: 'oneOnOne', members: [{ userId: 'arjun', displayName: 'Arjun', email: 'arjun@example.com' }] }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/chats?$skiptoken=next' }))
    const response = await app.request('/teams/chats')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items[0]).toMatchObject({ id: 'chat', members: [{ displayName: 'Arjun' }] })
    expect(body.nextCursor).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('accessToken')
  })
  it('refreshes expired tokens and uses the new token for Microsoft Graph', async () => {
    const { app, fetcher, expire } = await fixture(); expire()
    fetcher.mockResolvedValueOnce(Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })).mockResolvedValueOnce(Response.json({ value: [] }))
    expect((await app.request('/teams/chats')).status).toBe(200)
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain('grant_type=refresh_token')
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ Authorization: 'Bearer new-access' })
  })
  it('sends only the submitted plain-text message and rejects empty messages', async () => {
    const { app, fetcher } = await fixture()
    fetcher.mockResolvedValue(Response.json({ id: 'message', body: { contentType: 'text', content: 'Hello Arjun' }, from: { user: { id: 'maya', displayName: 'Maya' } }, createdDateTime: new Date().toISOString() }))
    const response = await app.request('/teams/chats/chat/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hello Arjun', requestId: 'one' }) })
    expect(response.status).toBe(201)
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ body: { contentType: 'text', content: 'Hello Arjun' } })
    const duplicate = await app.request('/teams/chats/chat/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hello Arjun', requestId: 'one' }) })
    expect(duplicate.status).toBe(201); expect(fetcher).toHaveBeenCalledTimes(1)
    expect((await app.request('/teams/chats/chat/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '  ', requestId: 'empty' }) })).status).toBe(400)
  })
  it('rejects pagination URLs outside Microsoft Graph before sending credentials', async () => {
    const { app, fetcher } = await fixture()
    const cursor = Buffer.from('https://attacker.example/steal').toString('base64url')
    expect((await app.request(`/teams/chats?cursor=${cursor}`)).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('returns actionable permission and reconnect errors', async () => {
    const { app, fetcher } = await fixture()
    fetcher.mockResolvedValue(new Response('', { status: 403 }))
    expect((await (await app.request('/teams/chats')).json()).error).toMatch(/permission|consent/i)
    fetcher.mockResolvedValue(new Response('', { status: 401 }))
    expect((await (await app.request('/teams/chats')).json()).error).toMatch(/Reconnect/i)
  })
  it('marks older connections for reconnection without deleting their credentials', async () => {
    const { app, settings, fetcher } = await fixture()
    const file = join(settings.directory, 'teams.json'); const saved = JSON.parse(await readFile(file, 'utf8'))
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(settings.key, 'base64'), Buffer.from(saved.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(saved.tag, 'base64'))
    const connection = JSON.parse(Buffer.concat([decipher.update(Buffer.from(saved.data, 'base64')), decipher.final()]).toString())
    connection.scopes = 'User.Read Team.ReadBasic.All Channel.ReadBasic.All'
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(settings.key, 'base64'), iv)
    const data = Buffer.concat([cipher.update(JSON.stringify(connection)), cipher.final()])
    await writeFile(file, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }))
    expect(await (await app.request('/')).json()).toContainEqual(expect.objectContaining({ id: 'teams', connected: true, needsReconnect: true }))
    expect((await app.request('/teams/chats')).status).toBe(403); expect(fetcher).not.toHaveBeenCalled()
  })
  it('loads messages and shares one token refresh for simultaneous readers', async () => {
    const { app, fetcher, expire } = await fixture(); expire()
    fetcher.mockResolvedValueOnce(Response.json({ access_token: 'renewed', expires_in: 3600 })).mockImplementation(async () => Response.json({ value: [{ id: 'message', body: { content: '<p>Hello</p>', contentType: 'html' }, from: { user: { id: 'arjun', displayName: 'Arjun' } }, attachments: [{ name: 'Invalid link', contentUrl: 'javascript:alert(1)' }] }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/chats/chat/messages?$skiptoken=next' }))
    const results = await Promise.all([app.request('/teams/chats/chat/messages'), app.request('/teams/chats/chat/messages')])
    expect(results.every(response => response.status === 200)).toBe(true)
    const body = await results[0].json()
    expect(body.items[0]).toMatchObject({ sender: { name: 'Arjun' }, attachments: [{ name: 'Invalid link', url: null }] })
    expect(body.nextCursor).toBeTruthy()
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/token'))).toHaveLength(1)
  })
  it('retains ambiguous sends so retries never resend an unconfirmed message', async () => {
    const { app, fetcher } = await fixture(); fetcher.mockRejectedValue(new Error('timeout'))
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hello', requestId: 'uncertain' }) }
    expect(await (await app.request('/teams/chats/chat/messages', options)).json()).toMatchObject({ code: 'delivery_unknown' })
    expect((await app.request('/teams/chats/chat/messages', options)).status).toBe(502); expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
