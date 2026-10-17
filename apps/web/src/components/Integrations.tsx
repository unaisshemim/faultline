import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowUpRight, Check, Loader2, Plug, RefreshCw, ShieldCheck } from 'lucide-react'
import outlookLogo from '@/assets/integrations/microsoft-outlook.svg'
import teamsLogo from '@/assets/integrations/microsoft-teams.svg'
import { Link, useLocation } from 'react-router'
import type { IntegrationId, IntegrationStatus } from '../../../../shared/contracts'
import { request } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const providers = [
  { id: 'outlook' as const, title: 'Microsoft Outlook', logo: outlookLogo, description: 'Connect the mailbox and calendar you use for Itron.', features: ['Email access', 'Calendar access'], permission: 'Read your email and calendar. Company Brain cannot send email or change events.' },
  { id: 'teams' as const, title: 'Microsoft Teams', logo: teamsLogo, description: 'Read your Teams conversations and send replies from Company Brain.', features: ['Chat history', 'Send messages'], permission: 'Read conversations you belong to and send messages as your connected account, with basic team and channel access.' },
]
export function Integrations() {
  const location = useLocation()
  const [statuses, setStatuses] = useState<IntegrationStatus[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<IntegrationId | null>(null)
  const [setup, setSetup] = useState(false)
  const [disconnect, setDisconnect] = useState<IntegrationId | null>(null)
  const refresh = useCallback(async () => { try { setStatuses(await request<IntegrationStatus[]>('/integrations')); setError('') } catch { setError('Could not load your connections. Please try again.') } }, [])
  useEffect(() => {
    let active = true
    request<IntegrationStatus[]>('/integrations').then(value => { if (active) setStatuses(value) }).catch(() => { if (active) setError('Could not load your connections. Please try again.') })
    return () => { active = false }
  }, [])
  const connect = async (id: IntegrationId) => {
    if (!statuses?.find(status => status.id === id)?.configured) { setSetup(true); return }
    setBusy(id); setError('')
    try { const { url } = await request<{ url: string }>(`/integrations/${id}/connect`, { method: 'POST', body: '{}' }); window.location.assign(url) } catch (error) { setError(error instanceof Error ? error.message : 'Could not start Microsoft sign-in. Please try again.'); setBusy(null) }
  }
  const remove = async () => {
    if (!disconnect) return
    setBusy(disconnect); setError('')
    try { await request(`/integrations/${disconnect}/disconnect`, { method: 'POST', body: '{}' }); setDisconnect(null); await refresh() } catch { setError('Could not disconnect your account. Please try again.') } finally { setBusy(null) }
  }
  const result = new URLSearchParams(location.search)
  return <div className="main-content integrations-page">
    <header className="page-header"><span className="eyebrow">YOUR CONNECTED WORKSPACE</span><div><h1>Integrations</h1><Button variant="outline" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</Button></div><p>Connect Outlook and Teams for Itron operations, finance, and technology.</p></header>
    {(error || result.get('error')) && <div className="connection-error" role="alert"><AlertCircle size={16} />{error || result.get('error')}</div>}
    {statuses?.some(status => status.id === result.get('connected') && status.connected) && !error && <div className="integration-success" role="status"><Check size={16} /> Your Microsoft account is connected.</div>}
    {!statuses && !error && <div className="loading-work"><Loader2 size={18} className="animate-spin" /> Loading integrations…</div>}
    <div className="integration-grid">{providers.map(provider => {
      const status = statuses?.find(status => status.id === provider.id)
      return <Card className="integration-card" key={provider.id}>
        <div className="integration-card-top"><span className={`integration-icon ${provider.id}`}><img src={provider.logo} alt="" width={32} height={32} /></span><Badge variant="outline" className={status?.connected && !status.needsReconnect ? 'integration-connected' : ''}>{status?.needsReconnect ? 'Reconnect required' : status?.connected ? <><Check size={12} /> Connected</> : !status ? 'Checking…' : status.configured ? 'Not connected' : 'Setup required'}</Badge></div>
        <div><h2>{provider.title}</h2><p>{provider.description}</p></div>
        <div className="integration-features">{provider.features.map(feature => <span key={feature}><Check size={13} />{feature}</span>)}</div>
        {status?.connected && <div className="integration-account"><strong>{status.account?.name}</strong><span>{status.account?.email}</span></div>}
        <p className="integration-permission"><ShieldCheck size={14} />{provider.permission}</p>
        <div className="integration-card-footer"><Button disabled={!status || busy !== null} variant={status?.connected && !status.needsReconnect ? 'outline' : 'default'} onClick={() => status?.connected && !status.needsReconnect ? setDisconnect(provider.id) : void connect(provider.id)}>{busy === provider.id ? <Loader2 size={14} className="animate-spin" /> : status?.connected && !status.needsReconnect ? <Plug size={14} /> : <ArrowUpRight size={14} />}{status?.needsReconnect ? 'Reconnect Teams' : status?.connected ? 'Disconnect' : `Connect ${provider.id === 'outlook' ? 'Outlook' : 'Teams'}`}</Button>{status?.connected && <Button variant="ghost" disabled={busy !== null} onClick={() => status.needsReconnect ? setDisconnect(provider.id) : void connect(provider.id)}>{status.needsReconnect ? 'Disconnect' : 'Reconnect'}</Button>}{provider.id === 'teams' && status?.connected && !status.needsReconnect && <Button asChild variant="outline"><Link to="/chats">Open chats <ArrowUpRight size={14} /></Link></Button>}</div>
      </Card>
    })}</div>
    <div className="integration-note"><ShieldCheck size={18} /><div><strong>You control your connections</strong><p>Microsoft asks you to approve access before connecting. Disconnecting removes the saved credentials from this workspace. Teams messages are sent only when you choose Send in Chats. Background sync and automatic messaging are not enabled.</p></div></div>
    <Dialog open={setup} onOpenChange={setSetup}><DialogContent><DialogHeader><DialogTitle>Enable Microsoft connections</DialogTitle><DialogDescription>Microsoft sign-in needs to be configured by the workspace owner before you can connect an account.</DialogDescription></DialogHeader><p className="text-sm text-muted-foreground leading-relaxed">Register Company Brain in Microsoft Entra, add the app credentials to the backend, and restart it. Then return here to connect Outlook or Teams.</p><Button asChild variant="outline"><a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noreferrer">Open Microsoft Entra <ArrowUpRight size={14} /></a></Button><Button onClick={() => setSetup(false)}>Got it</Button></DialogContent></Dialog>
    <Dialog open={disconnect !== null} onOpenChange={open => { if (!open && !busy) setDisconnect(null) }}><DialogContent><DialogHeader><DialogTitle>Disconnect {disconnect === 'outlook' ? 'Outlook' : 'Teams'}?</DialogTitle><DialogDescription>This removes the saved credentials from Company Brain. You can connect again at any time. To revoke Microsoft consent too, manage the app’s permissions in your Microsoft account.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" disabled={busy !== null} onClick={() => setDisconnect(null)}>Keep connected</Button><Button variant="destructive" disabled={busy !== null} onClick={() => void remove()}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}Disconnect</Button></div></DialogContent></Dialog>
  </div>
}
