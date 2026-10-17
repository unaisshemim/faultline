import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Bell, CalendarDays, ChevronDown, Cloud, Ellipsis, Grip, MessageCircle, PanelLeft, PanelRightClose, Phone, Search, SquarePen, Users, UserPlus, Video, SquarePlus, ArrowUpRight } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router'
import type { ChatSummary, WorkData } from '../../../../shared/contracts'
import { getWork, request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { DropdownMenu as Menu } from 'radix-ui'
import { Input } from '@/components/ui/input'
import { FounderChat } from './FounderChat'
import { TaskDetail } from './TaskDetail'
import './live-test.css'

const DropdownMenu = Menu.Root
const DropdownMenuTrigger = Menu.Trigger
const DropdownMenuItem = Menu.Item
function DropdownMenuContent({ children }: { children: ReactNode }) {
  return <Menu.Portal><Menu.Content className="live-menu" sideOffset={7} align="end">{children}</Menu.Content></Menu.Portal>
}

export function LiveTestChat() {
  const location = useLocation()
  const navigate = useNavigate()
  const [draftId] = useState(() => `live-${crypto.randomUUID()}`)
  const chatId = new URLSearchParams(location.search).get('chat') || draftId
  const [data, setData] = useState<WorkData | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sidebar, setSidebar] = useState(() => window.innerWidth > 700)
  const [filter, setFilter] = useState('Chats')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const search = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === 'e') { event.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', search)
    return () => window.removeEventListener('keydown', search)
  }, [])
  const [locked, setLocked] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const refresh = useCallback(() => {
    void getWork().then(work => {
      setData(work); setError('')
      if (work.status.database) void request<ChatSummary[]>('/chats').then(setChats).catch(() => setError('Could not load saved chats. Try refreshing.'))
    }).catch(() => setError('Could not reach the API. Start the backend and try again.'))
  }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { if (!new URLSearchParams(location.search).has('chat')) navigate(`/live-test?chat=${encodeURIComponent(chatId)}`, { replace: true }) }, [chatId, location.search, navigate])
  const newChat = () => { if (!locked) navigate(`/live-test?chat=live-${crypto.randomUUID()}`) }
  const current = chats.find(chat => chat.id === chatId)
  const ready = data?.status.database && data.status.openai
  const visibleChats = chats.filter(chat => chat.id.startsWith('live-') && chat.title.toLowerCase().includes(query.toLowerCase()))
  const menu = <><DropdownMenuItem disabled={locked} onSelect={newChat}>New conversation</DropdownMenuItem><DropdownMenuItem onSelect={refresh}>Refresh connections</DropdownMenuItem><DropdownMenuItem onSelect={() => navigate('/?settings=1')}>Connection settings</DropdownMenuItem><DropdownMenuItem onSelect={() => navigate('/')}>Back to workspace</DropdownMenuItem></>
  return <div className={`live-test dark ${sidebar ? '' : 'sidebar-hidden'}`}>
    <header className="live-topbar">
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Workspace apps"><Grip size={25} /></Button></DropdownMenuTrigger><DropdownMenuContent>{menu}</DropdownMenuContent></DropdownMenu>
      <Button variant="ghost" size="icon" aria-label="Toggle chat sidebar" onClick={() => setSidebar(value => !value)}><PanelLeft size={22} /></Button>
      <div className="live-global-search"><Search size={21} /><Input ref={searchRef} aria-label="Search test conversations" placeholder="Search (⌥ ⌘ E)" value={query} onChange={event => { setQuery(event.target.value); setFilter('Chats') }} /></div>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="live-top-more" aria-label="Workspace options"><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent>{menu}</DropdownMenuContent></DropdownMenu>
      <span className="live-user" aria-label="You">U<i /></span>
    </header>
    <div className="live-layout">
      <nav className="live-rail" aria-label="Workspace">
        <Link to="/updates" aria-label="Activity"><Bell /></Link><span className="live-rail-active" aria-label="Chat" aria-current="page"><MessageCircle /></span><Link to="/tasks" aria-label="Tasks"><CalendarDays /></Link><Link to="/integrations" aria-label="Calling integrations"><Phone /></Link><Link to="/integrations" aria-label="Cloud integrations"><Cloud /></Link><Link to="/" aria-label="Company Brain"><span className="live-copilot-mark">♧</span></Link><Button variant="ghost" size="icon" aria-label="New test conversation" disabled={locked} onClick={newChat}><SquarePlus /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More apps"><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent>{menu}</DropdownMenuContent></DropdownMenu>
      </nav>
      <aside className="live-conversations">
        <div className="live-list-title"><h1>Chat</h1><div><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Chat options"><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent>{menu}</DropdownMenuContent></DropdownMenu><Button variant="ghost" size="icon" aria-label="Find a conversation" onClick={() => searchRef.current?.focus()}><Search /></Button><Button variant="ghost" size="icon" aria-label="New conversation" disabled={locked} onClick={newChat}><SquarePen /></Button><Button variant="ghost" size="icon" aria-label="Toggle chat list" onClick={() => setSidebar(false)}><ChevronDown size={18} /></Button></div></div>
        <div className="live-filters">{['Unread', 'Channels', 'Chats', 'Meeting chats'].map(label => <Button key={label} variant="ghost" aria-pressed={filter === label} onClick={() => setFilter(value => value === label ? 'Chats' : label)}>{label}</Button>)}<ChevronDown size={18} /></div>
        <div className="live-sidebar-scroll">
          <Button variant="ghost" className="live-nav-row live-copilot" disabled={locked} onClick={newChat}><span className="live-copilot-mark">♧</span> Copilot</Button>
          <details className="live-group" open><summary>Quick views</summary><Button variant="ghost" className="live-nav-row" disabled={locked} onClick={newChat}><SquarePen />Drafts</Button></details>
          <details className="live-group live-favourites" open><summary>Favourites</summary><Button variant="ghost" className="live-nav-row" disabled={locked} onClick={newChat}><span className="live-small-avatar self-avatar">U<i /></span>You</Button></details>
          <details className="live-group" open><summary>Chats</summary><div className="live-chat-list">
            {filter === 'Unread' || filter === 'Meeting chats' ? <p className="live-list-empty">{filter === 'Unread' ? 'You’re all caught up.' : 'No meeting chats yet.'}</p> : filter === 'Channels' ? <Link to="/team" className="live-nav-row"><Users />Itron R&D</Link> : <>
              {!current && !query && <div className="live-chat-item selected" aria-current="true"><span className="live-small-avatar brain-avatar">CB<i /></span><span>Company Brain</span></div>}
              {visibleChats.map(chat => <Button key={chat.id} variant="ghost" className={`live-chat-item ${chat.id === chatId ? 'selected' : ''}`} disabled={locked} aria-current={chat.id === chatId ? 'true' : undefined} title={chat.title} onClick={() => navigate(`/live-test?chat=${encodeURIComponent(chat.id)}`)}><span className="live-small-avatar brain-avatar">CB<i /></span><span>{chat.title}</span></Button>)}
              {query && !visibleChats.length && <p className="live-list-empty">No conversations found.</p>}
            </>}
          </div></details>
          <details className="live-group" open><summary>Teams and channels</summary><details className="live-channel" open><summary><span className="live-channel-avatar"><Users size={18} /></span>Itron R&D</summary><Link to="/team">General</Link></details><Link className="live-section-link" to="/team">See all your teams</Link></details>
          <details className="live-group live-community" open><summary>Communities</summary><Link className="live-nav-row" to="/team"><span className="live-community-avatar">AC</span>All Company</Link><Link className="live-section-link" to="/team">View community</Link></details>
        </div>
      </aside>
      <main className="live-main">
        <header className="live-conversation-header">
          <span className="live-contact-avatar">CB<i className={ready ? 'online' : ''} /></span><h2>Company Brain</h2>
          <div className="live-conversation-tabs"><span>Chat</span><button disabled title="Shared files are available in the conversation">Shared</button><button disabled>Notes</button><button disabled>Recap</button><button disabled>Storyline</button><Button variant="ghost" size="icon" aria-label="New chat" disabled={locked} onClick={newChat}><SquarePlus size={20} /></Button></div>
          <div className="live-header-actions"><Button variant="ghost" size="icon" disabled aria-label="Video calling is not available"><Video /></Button><ChevronDown size={17} /><Link to="/team" aria-label="View team"><UserPlus /></Link><span className="live-action-divider" /><Button variant="ghost" size="icon" aria-label="Search conversations" onClick={() => searchRef.current?.focus()}><Search /></Button><Button variant="ghost" size="icon" aria-label="Toggle chat sidebar" onClick={() => setSidebar(value => !value)}><PanelRightClose /></Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Conversation options"><Ellipsis /></Button></DropdownMenuTrigger><DropdownMenuContent>{menu}</DropdownMenuContent></DropdownMenu></div>
        </header>
        <div className="live-chat-body">
          {error && <div className="live-warning" role="alert">{error}<Button variant="ghost" size="sm" onClick={refresh}>Retry</Button></div>}
          {data && !ready && <div className="live-warning">{!data.status.database ? 'Connect FalkorDB to save conversations and test the AI.' : 'Configure the OpenAI API key to receive AI replies.'}<Link to="/?settings=1">Connection settings <ArrowUpRight size={13} /></Link></div>}
          {data ? <FounderChat live key={chatId} chatId={chatId} system={data.status} onNewChat={newChat} onChanged={refresh} onTask={setTaskId} onSettings={() => navigate('/?settings=1')} starter="" onStarterUsed={() => {}} onBusyChange={setLocked} /> : <div className="live-loading" role="status">{error ? 'Waiting for the backend…' : 'Loading your workspace…'}</div>}
        </div>
      </main>
    </div>
    {data && <TaskDetail task={data.tasks.find(task => task.id === taskId)} data={data} onClose={() => setTaskId(null)} onChanged={refresh} onDemo={() => navigate('/tasks')} />}
  </div>
}
