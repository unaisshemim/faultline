import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, Loader2, MessageSquare, Paperclip, RefreshCw, Search, Send } from 'lucide-react'
import { Link } from 'react-router'
import type { IntegrationStatus, TeamsChat, TeamsMessage, TeamsPage } from '../../../../shared/contracts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import teamsLogo from '@/assets/integrations/microsoft-teams.svg'

class TeamsApiError extends Error {
  readonly code: string
  constructor(message: string, code = '') { super(message); this.code = code }
}
async function teamsRequest<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  try { response = await fetch(`/api/integrations${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } }) } catch (error) { if (options?.method === 'POST') throw new TeamsApiError('Delivery could not be confirmed. Refresh the conversation before sending again.', 'delivery_unknown'); throw error }
  const data = await response.json()
  if (!response.ok) throw new TeamsApiError(data.error || 'Could not reach Microsoft Teams.', data.code)
  return data as T
}
// Render Microsoft HTML as plain text. Remote markup is never inserted into the page.
function plainText(value: string) {
  const template = document.createElement('template')
  template.innerHTML = value
  template.content.querySelectorAll('script,style').forEach(node => node.remove())
  template.content.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
  template.content.querySelectorAll('p,div,li').forEach(node => node.append('\n'))
  return (template.content.textContent || '').trim()
}
const dedupe = <T extends { id: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()]
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'
function chatTitle(chat: TeamsChat, ownId?: string) { return chat.topic || chat.members.filter(member => member.userId !== ownId).map(member => member.displayName).join(', ') || (chat.chatType === 'meeting' ? 'Meeting conversation' : 'Teams conversation') }
function stamp(value: string | null, full = false) { if (!value || !Number.isFinite(Date.parse(value))) return ''; return new Intl.DateTimeFormat('en', full ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' }).format(new Date(value)) }

export function TeamsChats() {
  const [connection, setConnection] = useState<IntegrationStatus | null>(null)
  const [chats, setChats] = useState<TeamsChat[]>([])
  const [nextChats, setNextChats] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<TeamsMessage[]>([])
  const [nextMessages, setNextMessages] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadingChats, setLoadingChats] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [messageError, setMessageError] = useState('')
  const [sendError, setSendError] = useState('')
  const [deliveryUnknown, setDeliveryUnknown] = useState(false)
  const [reconnect, setReconnect] = useState(false)
  const transcript = useRef<HTMLDivElement>(null)
  const scrollMode = useRef<'bottom' | number | null>('bottom')
  const sendRequest = useRef<{ chat: string; text: string; id: string } | null>(null)
  const selection = useRef(selectedId)
  useLayoutEffect(() => { selection.current = selectedId }, [selectedId])
  const selected = chats.find(chat => chat.id === selectedId)
  const draft = selectedId ? drafts[selectedId] || '' : ''
  const ready = connection?.connected && !connection.needsReconnect && !reconnect
  const handleError = useCallback((error: unknown, setter: (value: string) => void) => { setter(errorMessage(error)); if (error instanceof TeamsApiError && error.code === 'reconnect_required') setReconnect(true) }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setReconnect(false)
    try {
      const status = (await teamsRequest<IntegrationStatus[]>('', { signal })).find(item => item.id === 'teams') || null
      if (signal?.aborted) return
      setConnection(status)
      if (status?.connected && !status.needsReconnect) {
        const page = await teamsRequest<TeamsPage<TeamsChat>>('/teams/chats', { signal })
        if (!signal?.aborted) { setChats(page.items); setNextChats(page.nextCursor) }
      }
    } catch (error) { if (!signal?.aborted) handleError(error, setError) } finally { if (!signal?.aborted) setLoading(false) }
  }, [handleError])
  useEffect(() => { const abort = new AbortController(); void load(abort.signal); return () => abort.abort() }, [load])
  const loadMessages = useCallback(async (id: string, cursor?: string, signal?: AbortSignal) => {
    setLoadingMessages(true); setMessageError('')
    try {
      const page = await teamsRequest<TeamsPage<TeamsMessage>>(`/teams/chats/${encodeURIComponent(id)}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
      if (signal?.aborted || selection.current !== id) return
      scrollMode.current = cursor ? transcript.current?.scrollHeight || 0 : 'bottom'
      setMessages(previous => dedupe(cursor ? [...page.items, ...previous] : page.items).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')))
      setNextMessages(page.nextCursor)
      if (!cursor) { setDeliveryUnknown(false); sendRequest.current = null }
    } catch (error) { if (!signal?.aborted && selection.current === id) handleError(error, setMessageError) } finally { if (!signal?.aborted && selection.current === id) setLoadingMessages(false) }
  }, [handleError])
  useEffect(() => {
    setMessages([]); setNextMessages(null); setSendError(''); setDeliveryUnknown(false); sendRequest.current = null
    if (!selectedId) return
    const abort = new AbortController(); void loadMessages(selectedId, undefined, abort.signal)
    return () => abort.abort()
  }, [selectedId, loadMessages])
  useLayoutEffect(() => { if (transcript.current && scrollMode.current !== null) { transcript.current.scrollTop = scrollMode.current === 'bottom' ? transcript.current.scrollHeight : transcript.current.scrollHeight - scrollMode.current; scrollMode.current = null } }, [messages])
  const moreChats = async () => {
    if (!nextChats || loadingChats) return
    setLoadingChats(true); setError('')
    try { const page = await teamsRequest<TeamsPage<TeamsChat>>(`/teams/chats?cursor=${encodeURIComponent(nextChats)}`); setChats(previous => dedupe([...previous, ...page.items])); setNextChats(page.nextCursor) } catch (error) { handleError(error, setError) } finally { setLoadingChats(false) }
  }
  const send = async () => {
    if (!selectedId || !draft.trim() || sending || deliveryUnknown || !ready || loadingMessages) return
    const chat = selectedId; const text = draft.trim()
    const request = sendRequest.current?.chat === chat && sendRequest.current.text === text ? sendRequest.current : { chat, text, id: crypto.randomUUID() }
    sendRequest.current = request; setSending(true); setSendError('')
    try {
      const sent = await teamsRequest<TeamsMessage>(`/teams/chats/${encodeURIComponent(chat)}/messages`, { method: 'POST', body: JSON.stringify({ text, requestId: request.id }) })
      if (selection.current === chat) { scrollMode.current = 'bottom'; setMessages(previous => dedupe([...previous, sent])); setDrafts(previous => ({ ...previous, [chat]: '' })) }
      setChats(previous => previous.map(item => item.id === chat ? { ...item, preview: text, updatedAt: sent.createdAt } : item))
      sendRequest.current = null
    } catch (error) { handleError(error, setSendError); if (error instanceof TeamsApiError && error.code === 'delivery_unknown') setDeliveryUnknown(true) } finally { setSending(false) }
  }
  const visible = chats.filter(chat => `${chatTitle(chat, connection?.account?.id)} ${plainText(chat.preview)}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="main-content teams-chats-page">
    <header className="page-header"><div><div className="teams-page-title"><img src={teamsLogo} alt="" width={28} height={28} /><h1>Chats</h1></div><Button variant="outline" disabled={loading || sending || loadingChats} onClick={() => void load()}><RefreshCw size={14} /> Refresh</Button></div><p>Read and reply to the Teams conversations you use for Itron.</p></header>
    {error && <div className="connection-error" role="alert"><AlertCircle size={16} />{error}</div>}
    {loading ? <div className="loading-work"><Loader2 size={18} className="animate-spin" /> Loading Teams conversations…</div> : !ready ? <div className="teams-connect-state"><img src={teamsLogo} alt="" width={44} height={44} /><h2>{connection?.connected ? 'Approve access to your chats' : 'Connect Microsoft Teams'}</h2><p>{connection?.connected ? 'Your existing connection needs permission to read conversations and send messages. Reconnect Teams and approve access in Microsoft.' : 'Connect your work account to see the Teams conversations you belong to.'}</p><Button asChild><Link to="/integrations">{connection?.connected ? 'Reconnect Teams' : 'Open Integrations'} <ArrowUpRight size={14} /></Link></Button></div> : <div className={`teams-chat-layout ${selected ? 'has-selection' : ''}`}>
      <aside className="teams-conversations" aria-label="Teams conversations"><div className="teams-conversations-header"><strong>Conversations <span>{chats.length}{nextChats ? '+' : ''}</span></strong><div className="teams-chat-search"><Search size={14} /><Input aria-label="Search loaded conversations" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search conversations" /></div></div><div className="teams-conversations-list">{visible.map(chat => <Button variant="ghost" className={`teams-conversation ${selectedId === chat.id ? 'selected' : ''}`} key={chat.id} disabled={sending} aria-pressed={selectedId === chat.id} onClick={() => setSelectedId(chat.id)}><span className="teams-conversation-avatar">{chatTitle(chat, connection?.account?.id).slice(0, 1).toUpperCase()}</span><span className="teams-conversation-copy"><strong>{chatTitle(chat, connection?.account?.id)}</strong><span>{plainText(chat.preview) || (chat.chatType === 'oneOnOne' ? 'Direct message' : chat.chatType === 'meeting' ? 'Meeting chat' : 'Group chat')}</span></span><time>{stamp(chat.updatedAt)}</time></Button>)}{!visible.length && <div className="teams-list-empty">{query ? 'No loaded conversations match your search.' : 'No Teams conversations found.'}</div>}{nextChats && <Button variant="ghost" className="teams-load-more" disabled={loadingChats} onClick={() => void moreChats()}>{loadingChats && <Loader2 size={14} className="animate-spin" />}Load more conversations</Button>}</div><div className="teams-account-label"><Check size={12} />{connection?.account?.email}</div></aside>
      <section className="teams-conversation-panel" aria-label="Selected conversation">{!selected ? <div className="teams-no-selection"><MessageSquare size={32} strokeWidth={1.3} /><h2>Select a conversation</h2><p>Choose a chat to read its history or send a reply.</p></div> : <><div className="teams-conversation-heading"><Button variant="ghost" size="icon" className="teams-back" disabled={sending} aria-label="Back to conversations" onClick={() => setSelectedId(null)}><ArrowLeft size={18} /></Button><div><h2>{chatTitle(selected, connection?.account?.id)}</h2><p>{selected.chatType === 'oneOnOne' ? 'Direct conversation' : `${selected.members.length} participants`}</p></div><Button variant="ghost" size="icon" disabled={loadingMessages || sending} aria-label="Refresh conversation" onClick={() => void loadMessages(selected.id)}><RefreshCw size={15} /></Button>{selected.webUrl && <Button variant="ghost" size="icon" asChild><a href={selected.webUrl} target="_blank" rel="noreferrer" aria-label="Open conversation in Teams"><ArrowUpRight size={16} /></a></Button>}</div>
        <div className="teams-live-messages" ref={transcript} aria-busy={loadingMessages}>{nextMessages && <Button className="teams-load-more" variant="ghost" disabled={loadingMessages || sending} onClick={() => void loadMessages(selected.id, nextMessages)}>{loadingMessages && <Loader2 size={14} className="animate-spin" />}Load older messages</Button>}{loadingMessages && !messages.length ? <div className="loading-work"><Loader2 size={18} className="animate-spin" /> Loading messages…</div> : null}{messageError && <div className="connection-error" role="alert">{messageError}<Button variant="outline" size="sm" onClick={() => void loadMessages(selected.id)}>Retry</Button></div>}{!loadingMessages && !messageError && !messages.length && <p className="teams-list-empty">No messages in this conversation yet.</p>}{messages.map(item => <article key={item.id} className={`teams-live-message ${connection?.account?.id && item.sender.id === connection.account.id ? 'self' : ''}`}><div className="teams-live-message-meta"><strong>{item.sender.name}</strong><time>{stamp(item.createdAt, true)}</time></div><div className="teams-live-message-body">{item.deleted ? <em>Message deleted</em> : item.contentType.toLowerCase() === 'html' ? plainText(item.content) : item.content}{item.attachments.map((attachment, index) => <div className="teams-attachment" key={index}><Paperclip size={13} />{attachment.url ? <a href={attachment.url} target="_blank" rel="noreferrer">{attachment.name}</a> : <span>{attachment.name} · Open in Teams</span>}</div>)}</div></article>)}</div>
        <div className="teams-live-composer">{sendError && <div className="inline-error" role="alert"><AlertCircle size={14} />{sendError}</div>}{deliveryUnknown && <Button variant="outline" size="sm" onClick={() => void loadMessages(selected.id)}>Refresh before sending again</Button>}<Textarea aria-label="Message Teams conversation" placeholder="Write a message…" value={draft} maxLength={8000} disabled={sending || loadingMessages || reconnect} onChange={event => setDrafts(previous => ({ ...previous, [selected.id]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send() } }} /><div className="teams-live-composer-bottom"><span>Send as {connection?.account?.name || 'your connected account'} <span className="teams-send-hint">· ⌘ / Ctrl + Enter</span></span><Button disabled={!draft.trim() || sending || loadingMessages || deliveryUnknown || reconnect} onClick={() => void send()}>{sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}Send</Button></div></div>
      </>}</section>
    </div>}
  </div>
}
