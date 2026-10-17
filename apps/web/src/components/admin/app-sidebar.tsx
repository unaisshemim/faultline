// Adapted from marmelab/shadcn-admin-kit, using the existing Radix shadcn primitives.
import { createElement } from 'react'
import { LinkBase, useHasDashboard, useResourceDefinitions, useMatch } from 'ra-core'
import { Brain, House, List, ChevronUp } from 'lucide-react'
import { PersonAvatar } from '@/components/PersonAvatar'
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'

export function AppSidebar() {
  const resources = useResourceDefinitions()
  const hasDashboard = useHasDashboard()
  const { setOpenMobile } = useSidebar()
  const close = () => setOpenMobile(false)
  return <Sidebar variant="floating" collapsible="icon">
    <SidebarHeader><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild className="h-12 group-data-[collapsible=icon]:!p-0"><LinkBase to="/" onClick={close}><span className="admin-logo"><Brain className="!size-5" /></span><span className="font-semibold text-base">Company Brain</span></LinkBase></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarHeader>
    <SidebarContent><SidebarGroup><SidebarGroupLabel>Itron</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
      {hasDashboard && <MenuLink to="/" label="Home" icon={House} onClick={close} />}
      {Object.entries(resources).filter(([name, resource]) => resource.hasList && name !== 'updates').map(([name, resource]) => <MenuLink key={name} to={`/${name}`} label={resource.options?.label || name} icon={resource.icon || List} onClick={close} />)}
    </SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent>
    <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild className="h-14" tooltip="Workspace settings"><LinkBase to="/?settings=1" onClick={close}><PersonAvatar name="Itron" initials="I" className="admin-user-avatar" /><span className="flex flex-col"><span className="font-medium">Itron</span><span className="text-xs text-muted-foreground">Itron · Demo workspace</span></span><ChevronUp className="ml-auto" /></LinkBase></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
  </Sidebar>
}
function MenuLink({ to, label, icon, onClick }: { to: string; label: string; icon: React.ComponentType; onClick: () => void }) {
  const match = useMatch({ path: to, end: to === '/' })
  return <SidebarMenuItem><SidebarMenuButton asChild isActive={!!match} tooltip={label}><LinkBase to={to} onClick={onClick} aria-current={match ? 'page' : undefined}>{createElement(icon)}<span>{label}</span></LinkBase></SidebarMenuButton></SidebarMenuItem>
}
