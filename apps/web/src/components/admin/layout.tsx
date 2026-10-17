// Layout adapted from marmelab/shadcn-admin-kit. See LICENSE.
import { Suspense } from 'react'
import type { CoreLayoutProps } from 'ra-core'
import { ErrorBoundary } from 'react-error-boundary'
import { Moon, Sun, ChevronRight } from 'lucide-react'
import { useLocation } from 'react-router'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { ChatHistoryPanel } from '@/components/ChatHistoryPanel'
import { AppSidebar } from './app-sidebar'
import { useTheme } from './use-theme'

export function Layout({ children }: CoreLayoutProps) {
  const { theme, setTheme } = useTheme()
  const location = useLocation()
  const title = location.pathname.startsWith('/tasks') ? 'Tasks' : location.pathname.startsWith('/team') ? 'Team' : location.pathname.startsWith('/updates') ? 'Updates' : location.pathname.startsWith('/chats') ? 'Chats' : location.pathname.startsWith('/integrations') ? 'Integrations' : 'Home'
  if (location.pathname.startsWith('/live-test') || location.pathname.startsWith('/incident')) return <>{children}</>
  return <SidebarProvider><AppSidebar /><main className="admin-main">
    <header className="admin-header"><SidebarTrigger aria-label="Toggle navigation" /><span className="admin-header-divider" /><span className="text-muted-foreground text-sm">Itron</span><ChevronRight className="size-3 text-muted-foreground" /><span className="text-sm font-medium">{title}</span><div className="ml-auto flex items-center gap-2"><span className="admin-demo-label">Itron demo</span><Button variant="ghost" size="icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>{title === 'Home' && <ChatHistoryPanel />}</div></header>
    <ErrorBoundary resetKeys={[location.pathname]} fallbackRender={({ resetErrorBoundary }) => <div className="p-8"><h1 className="text-xl font-semibold">Could not display this page</h1><Button className="mt-4" onClick={resetErrorBoundary}>Try again</Button></div>}><Suspense fallback={<div className="p-8 text-muted-foreground">Loading workspace…</div>}>{children}</Suspense></ErrorBoundary>
  </main></SidebarProvider>
}
