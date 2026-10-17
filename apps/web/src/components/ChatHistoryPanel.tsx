import { useEffect, useState } from 'react'
import { AlertCircle, ArrowUpRight, History, Loader2, MessageSquare, RefreshCw, Search } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import type { ChatSummary } from '../../../../shared/contracts'
import { request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { relativeTime } from './WorkUI'

export function ChatHistoryPanel() {
  const [open, setOpen] = useState(false)
  const [conversations, setConversations] = useState<ChatSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [revision, setRevision] = useState(0)
  const navigate = useNavigate()
  const location = useLocation()
  const selectedId = new URLSearchParams(location.search).get('chat')
  useEffect(() => {
    if (!open) return
    const abort = new AbortController()
    setLoading(true); setError('')
    request<ChatSummary[]>('/chats', { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) setConversations(value)
    }).catch(() => {
      if (!abort.signal.aborted) setError('Could not load conversation history.')
    }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [open, revision])
  const visible = conversations.filter(chat => chat.title.toLowerCase().includes(query.toLowerCase()))
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button variant="ghost" size="icon" className="history-trigger" aria-label="Open chat history" title="Chat history"><History size={16} /></Button></SheetTrigger>
    <SheetContent side="right" className="chat-history-panel">
      <SheetHeader><SheetTitle>Chat history</SheetTitle><SheetDescription>Reopen a previous Itron conversation.</SheetDescription></SheetHeader>
      <div className="history-search"><Search size={15} /><Input aria-label="Search chat history" placeholder="Search conversations…" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="history-conversations" aria-busy={loading}>
        {loading ? <div className="history-empty" role="status"><Loader2 size={18} className="animate-spin" /><span>Loading conversations…</span></div> : error ? <div className="history-empty" role="alert"><AlertCircle size={18} /><p>{error}</p><Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /> Retry</Button></div> : visible.length ? visible.map(chat => <Button variant="ghost" key={chat.id} className="history-conversation" aria-current={selectedId === chat.id ? 'true' : undefined} onClick={() => { navigate(`/?chat=${encodeURIComponent(chat.id)}`); setOpen(false) }}><MessageSquare size={16} /><span><strong>{chat.title}</strong><small>{chat.messageCount} messages · {relativeTime(chat.updatedAt)}</small></span><ArrowUpRight size={14} /></Button>) : <div className="history-empty"><History size={22} /><p>{query ? 'No conversations match your search.' : 'Your saved conversations will appear here.'}</p></div>}
      </div>
    </SheetContent>
  </Sheet>
}
