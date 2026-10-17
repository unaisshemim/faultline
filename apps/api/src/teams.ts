import { Hono } from 'hono'
import { z } from 'zod'
import { MicrosoftError, type MicrosoftConnections } from './integrations.js'
import type { TeamsChat, TeamsMessage } from '../../../shared/contracts.js'

interface GraphChat { id: string; topic?: string; chatType?: string; members?: { userId?: string; displayName?: string; email?: string }[]; lastUpdatedDateTime?: string; webUrl?: string; lastMessagePreview?: { body?: { content?: string } } }
interface GraphMessage { id: string; body?: { content?: string; contentType?: string }; from?: { user?: { id?: string; displayName?: string }; application?: { displayName?: string } }; createdDateTime?: string; deletedDateTime?: string; attachments?: { name?: string; contentUrl?: string }[] }
interface GraphPage<T> { value: T[]; '@odata.nextLink'?: string }
const safeUrl = (value?: string) => { try { const url = new URL(value || ''); return url.protocol === 'https:' ? url.toString() : null } catch { return null } }
const message = (item: GraphMessage): TeamsMessage => ({ id: item.id, content: item.body?.content || '', contentType: item.body?.contentType || 'text', sender: { id: item.from?.user?.id || '', name: item.from?.user?.displayName || item.from?.application?.displayName || 'Teams' }, createdAt: item.createdDateTime || null, deleted: Boolean(item.deletedDateTime), attachments: (item.attachments || []).map(attachment => ({ name: attachment.name || 'Attachment', url: safeUrl(attachment.contentUrl) })) })

function pageUrl(initial: string, cursor?: string) {
  if (!cursor) return initial
  if (cursor.length > 12000) throw new MicrosoftError('Invalid continuation. Refresh the conversation.', 400)
  let url: URL
  try { url = new URL(Buffer.from(cursor, 'base64url').toString('utf8')) } catch { throw new MicrosoftError('Invalid continuation. Refresh the conversation.', 400) }
  const expected = new URL(initial, 'https://graph.microsoft.com')
  let samePath = false
  try { samePath = decodeURIComponent(url.pathname) === decodeURIComponent(expected.pathname) } catch { /* malformed cursor */ }
  if (url.origin !== expected.origin || !samePath || url.username || url.password || url.hash) throw new MicrosoftError('Invalid continuation. Refresh the conversation.', 400)
  return url.toString()
}
const cursor = (next?: string) => next ? Buffer.from(next).toString('base64url') : null
export function teamsRoutes(service: MicrosoftConnections) {
  const app = new Hono()
  // Retain successful and uncertain sends for 30 minutes; never retry a send automatically.
  const sends = new Map<string, { at: number; chat: string; text: string; result: Promise<TeamsMessage> }>()
  app.onError((error, c) => {
    if (error instanceof MicrosoftError) return c.json({ error: error.message, code: error.code }, error.status)
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'Enter a message of 1–8,000 characters.' }, 400)
    return c.json({ error: 'Could not access Microsoft Teams. Please try again.' }, 502)
  })
  app.get('/chats', async c => {
    const path = pageUrl('/v1.0/me/chats?$expand=members,lastMessagePreview&$top=50', c.req.query('cursor'))
    const result = await service.graph<GraphPage<GraphChat>>(path, ['Chat.Read'])
    const items: TeamsChat[] = result.value.map(item => ({ id: item.id, topic: item.topic || null, chatType: item.chatType || 'group', members: (item.members || []).map(member => ({ userId: member.userId || '', displayName: member.displayName || member.email || 'Participant', email: member.email || '' })), preview: item.lastMessagePreview?.body?.content || '', updatedAt: item.lastUpdatedDateTime || null, webUrl: safeUrl(item.webUrl) }))
    return c.json({ items, nextCursor: cursor(result['@odata.nextLink']) })
  })
  app.get('/chats/:id/messages', async c => {
    const path = pageUrl(`/v1.0/chats/${encodeURIComponent(c.req.param('id'))}/messages?$top=50&$orderby=createdDateTime%20desc`, c.req.query('cursor'))
    const result = await service.graph<GraphPage<GraphMessage>>(path, ['Chat.Read'])
    return c.json({ items: result.value.map(message), nextCursor: cursor(result['@odata.nextLink']) })
  })
  app.post('/chats/:id/messages', async c => {
    const input = z.object({ text: z.string().trim().min(1).max(8000), requestId: z.string().min(1).max(100) }).parse(await c.req.json())
    const chat = c.req.param('id')
    for (const [key, entry] of sends) if (Date.now() - entry.at > 30 * 60_000) sends.delete(key)
    let entry = sends.get(input.requestId)
    if (entry && (entry.chat !== chat || entry.text !== input.text)) throw new MicrosoftError('This send request was already used for another message.', 409)
    if (!entry) {
      if (sends.size >= 1000) throw new MicrosoftError('Too many send requests. Try again later.', 429)
      const result = service.graph<GraphMessage>(`/v1.0/chats/${encodeURIComponent(chat)}/messages`, ['ChatMessage.Send'], { body: { contentType: 'text', content: input.text } }).then(message).catch(error => { if (!(error instanceof MicrosoftError) || error.code !== 'delivery_unknown') sends.delete(input.requestId); throw error })
      entry = { at: Date.now(), chat, text: input.text, result }
      sends.set(input.requestId, entry)
    }
    return c.json(await entry.result, 201)
  })
  return app
}
