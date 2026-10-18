import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, ListTodo, UsersRound, Clock3, Sparkles, Search, Plus, Bell, ChevronDown, ArrowUpRight, CircleCheck, Circle, AlertCircle, MessageSquare, Loader2, Check, RefreshCw, X } from 'lucide-react'
import type { Task, WorkData } from '../../../shared/contracts'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Admin } from '@/components/admin/admin'
import { Resource } from 'ra-core'
import { useLocation, useNavigate } from 'react-router'
import { dataProvider } from '@/lib/data-provider'
import { useSidebar } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getWork } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Avatar, StatusBadge, dueLabel, relativeTime } from '@/components/WorkUI'
import { FounderChat } from '@/components/FounderChat'
import { DemoTeamsPanel } from '@/components/DemoTeamsPanel'
import { TaskDetail } from '@/components/TaskDetail'
import { Integrations } from '@/components/Integrations'
import { FaultlineLanding } from '@/components/FaultlineLanding'
import { IncidentLab } from '@/components/IncidentLab'
import { LiveTestChat } from '@/components/LiveTestChat'
import { TeamsChats } from '@/components/TeamsChats'
import { Plug, Mic, Workflow } from 'lucide-react'

type Page = 'home' | 'tasks' | 'team' | 'activity'
function IconButton({ label, children, onClick, className }: { label: string; children: React.ReactNode; onClick: () => void; className?: string }) {
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={label} onClick={onClick} className={className}>{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
}
export default function App() { return <Admin dataProvider={dataProvider} dashboard={FaultlineLanding}><Resource name="workspace" options={{ label: 'Company workspace' }} list={Workspace} /><Resource name="tasks" options={{ label: 'Tasks' }} icon={ListTodo} list={Workspace} /><Resource name="team" options={{ label: 'Team' }} icon={UsersRound} list={Workspace} /><Resource name="updates" options={{ label: 'Updates' }} icon={Clock3} list={Workspace} /><Resource name="chats" options={{ label: 'Chats' }} icon={MessageSquare} list={TeamsChats} /><Resource name="incident" options={{ label: 'Incident lab' }} icon={Workflow} list={IncidentLab} /><Resource name="live-test" options={{ label: 'Live test' }} icon={Mic} list={LiveTestChat} /><Resource name="integrations" options={{ label: 'Integrations' }} icon={Plug} list={Integrations} /></Admin> }
function Workspace() {
  const location = useLocation()
  const routeNavigate = useNavigate()
  const page: Page = location.pathname.startsWith('/tasks') ? 'tasks' : location.pathname.startsWith('/team') ? 'team' : location.pathname.startsWith('/updates') ? 'activity' : 'home'
  const setPage = useCallback((next: Page) => routeNavigate(next === 'home' ? '/workspace' : next === 'activity' ? '/updates' : `/${next}`), [routeNavigate])
  const [data, setData] = useState<WorkData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [settings, setSettings] = useState(false)
  const settingsOpen = settings || new URLSearchParams(location.search).get('settings') === '1'
  const changeSettings = (open: boolean) => { setSettings(open); if (!open && location.search) routeNavigate(location.pathname, { replace: true }) }
  const [newChatId, setNewChatId] = useState(() => crypto.randomUUID())
  const chatId = new URLSearchParams(location.search).get('chat') || newChatId
  const newConversation = () => { setNewChatId(crypto.randomUUID()); routeNavigate('/workspace') }
  const [demo, setDemo] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const filter = new URLSearchParams(location.search).get('filter') || 'all'
  const setFilter = (value: string) => routeNavigate({ pathname: '/tasks', search: value === 'all' ? '' : `?filter=${value}` })
  const starter = new URLSearchParams(location.search).get('prompt') || ''
  const { setOpenMobile: setSidebarOpen } = useSidebar()
  const [demoTarget, setDemoTarget] = useState<Task | undefined>()
  const searchRef = useRef<HTMLInputElement>(null)
  const refresh = useCallback(() => { void getWork().then(value => { setData(value); setLoadError('') }).catch(() => setLoadError('Could not reach the local API. Start the backend, then retry.')) }, [])
  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer) }, [refresh])
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus() } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler) }, [])
  const startChat = useCallback((text = '') => { routeNavigate(text ? `/workspace?prompt=${encodeURIComponent(text)}` : '/workspace'); setSidebarOpen(false); setTimeout(() => document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus(), 0) }, [setSidebarOpen, routeNavigate])
  const clearStarter = useCallback(() => routeNavigate(`/workspace?chat=${encodeURIComponent(chatId)}`, { replace: true }), [routeNavigate, chatId])
  const navigate = (next: Page) => { setPage(next); setSidebarOpen(false); setQuery('') }
  const departmentNames = [...new Set(data?.employees.map(employee => employee.department.trim() || 'Other') ?? [])]
  const departmentOrder = ['R&D', 'Support Team', 'Tech Team', 'Finance', 'Operations']
  const departments = [
    ...departmentOrder.filter(name => departmentNames.includes(name)),
    ...departmentNames.filter(name => !departmentOrder.includes(name)),
  ].map(name => ({ name, employees: data?.employees.filter(employee => (employee.department.trim() || 'Other') === name) ?? [] }))
  const updates = [...(data?.updates ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const tasks = data?.tasks ?? []
  const searchResults = query.trim() ? tasks.filter(t => `${t.title} ${t.description} ${data?.employees.find(e => e.id === t.ownerId)?.name || ''}`.toLowerCase().includes(query.toLowerCase())) : []
  const filteredTasks = tasks.filter(t => filter === 'all' || (filter === 'active' ? !['completed', 'cancelled'].includes(t.status) : t.status === filter))
  const taskRow = (task: Task) => <Button variant="ghost" className="plain-control task-row" key={task.id} onClick={() => setSelectedId(task.id)}>
    <span className={cn('task-symbol', task.status)}>{task.status === 'completed' ? <Check size={14} /> : task.status === 'blocked' ? <AlertCircle size={15} /> : <ListTodo size={15} />}</span>
    <div className="task-row-copy"><strong>{task.title}</strong><span>{data?.employees.find(e => e.id === task.ownerId)?.name || 'Needs an owner'} <span className="middot">·</span> {task.effortHours}h estimated</span></div>
    <StatusBadge status={task.status} /><span className="row-date">{dueLabel(task.dueAt, data?.status.timezone)}</span><ArrowUpRight size={14} className="row-arrow" />
  </Button>
  return <TooltipProvider delayDuration={150}><div className="workspace">
    
    {page !== 'home' && <div className="topbar"><div className="search-wrap"><Search size={17} strokeWidth={1.7} /><Input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Itron work" aria-label="Search tasks" /><kbd>⌘ K</kbd>{query && <Button variant="ghost" className="plain-control" aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></Button>}{query && <div className="search-results">{searchResults.length ? searchResults.map(task => <Button variant="ghost" className="plain-control" key={task.id} onClick={() => { setSelectedId(task.id); setQuery('') }}><ListTodo size={14} /><span>{task.title}</span><ArrowUpRight size={13} /></Button>) : <p>No tasks match “{query}”.</p>}</div>}</div><div className="topbar-actions"><IconButton label="View updates" onClick={() => navigate('activity')} className="notification-button"><Bell size={17} strokeWidth={1.7} />{data && data.counts.blocked > 0 && <span className="notification-count">{data.counts.blocked}</span>}</IconButton><IconButton label="Create task through chat" onClick={() => startChat()}><Plus size={20} strokeWidth={1.7} /></IconButton><IconButton label="Company settings" onClick={() => setSettings(true)}><ChevronDown size={17} /></IconButton></div></div>}
    <div className={cn("main-content", page === 'home' && 'home-content')}>
      {loadError && <div className="connection-error" role="alert"><AlertCircle size={15} />{loadError}<Button variant="ghost" size="sm" onClick={refresh}><RefreshCw size={13} /> Retry</Button></div>}
      {!data ? <div className="loading-work"><Loader2 size={20} className="animate-spin" /><span>Loading the Itron workspace…</span></div> : <>
        {data.status.preview && <div className="preview-banner"><AlertCircle size={14} /> Read-only preview. Connect FalkorDB to save tasks and updates.<Button variant="ghost" className="plain-control" onClick={() => setSettings(true)}>Connection details</Button></div>}
        <div className={page === 'home' ? 'home-page' : 'hidden'}>
          <FounderChat key={chatId} chatId={chatId} onNewChat={newConversation} system={data.status} onChanged={refresh} onTask={setSelectedId} onSettings={() => setSettings(true)} starter={starter} onStarterUsed={clearStarter} />
        </div>
        {page === 'tasks' && <div className="inner-page"><header className="page-header"><span className="eyebrow">A CLEARER PICTURE</span><div><h1>Tasks</h1><Button onClick={() => startChat()}><Plus size={15} /> Create with AI</Button></div><p>Track Itron R&D, customer support, platform work, billing, and field operations.</p></header>          <div className="dashboard-stats">{[{label:'Active tasks',value:data.counts.active,icon:ListTodo,page:'tasks' as Page},{label:'Blocked',value:data.counts.blocked,icon:AlertCircle,page:'tasks' as Page},{label:'Completed',value:data.counts.completed,icon:CircleCheck,page:'tasks' as Page},{label:'Team members',value:data.employees.length,icon:UsersRound,page:'team' as Page}].map(stat => <Button key={stat.label} variant="outline" className="stat-card" onClick={() => { navigate(stat.page); if (stat.page === 'tasks') setFilter(stat.label === 'Blocked' ? 'blocked' : stat.label === 'Completed' ? 'completed' : stat.label === 'Active tasks' ? 'active' : 'all') }}><span>{stat.label}<stat.icon size={16}/></span><strong>{stat.value}</strong><small>{stat.label === 'Blocked' ? 'Needs your attention' : stat.label === 'Team members' ? 'Across Itron' : stat.label === 'Completed' ? 'Work delivered' : 'Currently in motion'}</small></Button>)}</div>
<div className="task-page-actions"><Button variant="outline" size="sm" onClick={() => { setDemoTarget(undefined); setDemo(true) }}><MessageSquare size={14} /> Employee simulator</Button></div><div className="task-filters" role="group" aria-label="Filter tasks">{[{ id: 'all', label: 'All tasks' }, { id: 'active', label: 'Active' }, { id: 'blocked', label: 'Blocked' }, { id: 'completed', label: 'Completed' }].map(item => <Button variant="ghost" className={cn("plain-control", filter === item.id ? 'selected' : '')} key={item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{tasks.filter(t => item.id === 'all' || (item.id === 'active' ? !['completed', 'cancelled'].includes(t.status) : t.status === item.id)).length}</span></Button>)}</div><div className="task-rows all-tasks">{filteredTasks.map(taskRow)}{!filteredTasks.length && <p className="empty-section">No tasks here yet.</p>}</div><section className="work-section task-history"><div className="section-heading"><h2>Task history</h2><span className="section-note">Employee replies and system updates</span></div><div className="activity-feed">{updates.map(update => <Button variant="ghost" className="plain-control activity-item" key={update.id} onClick={() => setSelectedId(update.taskId)}><Avatar employee={data.employees.find(e => e.id === update.employeeId)} /><div><strong>{data.employees.find(e => e.id === update.employeeId)?.name || 'Company Brain'}<span>{update.origin === 'employee' ? 'Employee confirmed' : 'System update'}</span></strong><p>{update.text}</p><span className="activity-task">{tasks.find(t => t.id === update.taskId)?.title} <ArrowUpRight size={12} /></span></div><time>{relativeTime(update.createdAt)}</time></Button>)}{!data.updates.length && <p className="empty-section">Task updates will appear here.</p>}</div></section><p className="page-footnote">New work starts with a conversation. <Button variant="ghost" className="plain-control" onClick={() => startChat()}>Talk to Company Brain <ArrowUpRight size={12} /></Button></p></div>}
        {page === 'team' && <div className="inner-page"><header className="page-header"><span className="eyebrow">PEOPLE BEHIND THE PROGRESS</span><h1>Team</h1><p>Find the right owner across R&D, Support Team, Tech Team, Finance, and Operations.</p></header><div className="team-departments">{departments.map(department => <section className="team-department" key={department.name} aria-label={`${department.name} department`}><div className="department-heading"><h2>{department.name}</h2><Badge variant="secondary">{department.employees.length} {department.employees.length === 1 ? 'member' : 'members'}</Badge></div><div className="team-list">{department.employees.map(employee => <Card className="team-card" key={employee.id}><div className="team-card-header"><Avatar employee={employee} /><div><h3>{employee.name}</h3><p>{employee.role}</p></div><span className="department-label">{employee.department}</span></div><div className="responsibility-tags">{employee.responsibilities.map(r => <Badge variant="outline" key={r}>{r}</Badge>)}</div><div className="team-capacity-label"><span>{employee.allocatedHours}h committed</span><strong>{employee.availableHours}h available</strong></div><Progress className="capacity-bar" value={Math.min(100, employee.allocatedHours / employee.weeklyCapacityHours * 100)} /><span className="capacity-total">of {employee.weeklyCapacityHours}h weekly capacity</span><div className="employee-tasks">{tasks.filter(t => t.ownerId === employee.id && !['completed', 'cancelled'].includes(t.status)).map(t => <Button variant="ghost" className="plain-control" key={t.id} onClick={() => setSelectedId(t.id)}><Circle size={12} />{t.title}<ArrowUpRight size={12} /></Button>)}</div></Card>)}</div></section>)}</div><p className="page-footnote">Illustrative Itron staff. Capacity is a demo estimate based on assigned effort, not calendar availability.</p></div>}
        {page === 'activity' && <div className="inner-page"><header className="page-header"><span className="eyebrow">LESS CHASING. MORE CONTEXT.</span><h1>Updates</h1><p>Follow Itron rollout progress, billing blockers, and IoT recovery updates.</p></header><div className="activity-feed">{updates.map(update => <Button variant="ghost" className="plain-control activity-item" key={update.id} onClick={() => setSelectedId(update.taskId)}><Avatar employee={data.employees.find(e => e.id === update.employeeId)} /><div><strong>{data.employees.find(e => e.id === update.employeeId)?.name || 'Company Brain'}<span>{update.origin === 'employee' ? 'Employee confirmed' : 'System update'}</span></strong><p>{update.text}</p><span className="activity-task">{tasks.find(t => t.id === update.taskId)?.title} <ArrowUpRight size={12} /></span></div><time>{relativeTime(update.createdAt)}</time></Button>)}</div></div>}
      </>}
    </div>
    {data && <><DemoTeamsPanel key={demoTarget?.id || "general"} initialTask={demoTarget} open={demo} onOpenChange={setDemo} data={data} onChanged={refresh} /><TaskDetail task={tasks.find(t => t.id === selectedId)} data={data} onClose={() => setSelectedId(null)} onChanged={refresh} onDemo={() => { setDemoTarget(tasks.find(t => t.id === selectedId)); setDemo(true) }} /></>}
    <Dialog open={settingsOpen} onOpenChange={changeSettings}><DialogContent className="settings-dialog"><DialogHeader><span className="eyebrow">YOUR LOCAL WORKSPACE</span><DialogTitle>Make the connection.</DialogTitle><DialogDescription>Connections for the Itron demo workspace.</DialogDescription></DialogHeader><div className="settings-connection"><span className="setting-icon"><Brain size={18} /></span><div><strong>FalkorDB</strong><span>{data?.status.database ? 'Connected · persistent company data' : 'Not connected · showing read-only sample data'}</span></div><span className={cn('connection-dot', data?.status.database && 'connected')} /></div><div className="settings-connection"><span className="setting-icon"><Sparkles size={18} /></span><div><strong>OpenAI</strong><span>{data?.status.openai ? `${data.status.model} · key configured` : 'API key needed to start founder chat'}</span></div><span className={cn('connection-dot', data?.status.openai && 'connected')} /></div><div className="setup-instructions"><h3>Set up once, then just talk.</h3><p>Copy <code>.env.example</code> to <code>.env</code> in the project root. Add your OpenAI API key and restart the backend.</p><pre>OPENAI_API_KEY=your-key{'\n'}OPENAI_MODEL=gpt-4.1-mini</pre><p>Start the local database with <code>npm run db:up</code>, then the app with <code>npm run dev</code>. Your key stays on the backend.</p></div><p className="settings-note"><MessageSquare size={14} /> Employee check-ins are simulated. Connect Outlook and Teams in Integrations; live Teams replies are sent only when you choose Send in Chats.</p><Button variant="outline" onClick={() => { refresh(); changeSettings(false) }}><RefreshCw size={14} /> Check connections</Button></DialogContent></Dialog>
  </div></TooltipProvider>
}
