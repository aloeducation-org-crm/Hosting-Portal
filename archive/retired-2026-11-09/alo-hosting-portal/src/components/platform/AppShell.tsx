'use client'

import { useEffect, useMemo, lazy, Suspense } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { usePlatformStore, NAV_ITEMS, type ViewId } from '@/stores/usePlatformStore'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  LayoutDashboard, Globe, Link2, Database, Box, Server, Bot,
  Activity, GitBranch, ShieldCheck, HardDrive, CreditCard, Users,
  Mail, Settings, ChevronLeft, ChevronRight, LogOut, Bell, Command,
  Container, Shield, ScrollText, Network, FolderOpen,
} from 'lucide-react'
import { ALOLogoMark } from './ALOLogo'
import dynamic from 'next/dynamic'

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Globe, Link2, Database, Box, Server, Bot,
  Activity, GitBranch, ShieldCheck, HardDrive, CreditCard, Users,
  Mail, Settings, Container, Shield, ScrollText, Network, FolderOpen,
}

const AuthScreen = dynamic(() => import('./AuthScreen'), { ssr: false })

const DashboardView = lazy(() => import('./views/DashboardView'))
const WebsitesView = lazy(() => import('./views/WebsitesView'))
const DomainsView = lazy(() => import('./views/DomainsView'))
const DatabasesView = lazy(() => import('./views/DatabasesView'))
const ApplicationsView = lazy(() => import('./views/ApplicationsView'))
const AgentsView = lazy(() => import('./views/AgentsView'))
const MonitoringView = lazy(() => import('./views/MonitoringView'))
const CICDView = lazy(() => import('./views/CICDView'))
const SSLView = lazy(() => import('./views/SSLView'))
const BackupsView = lazy(() => import('./views/BackupsView'))
const ServersView = lazy(() => import('./views/ServersView'))
const ContainersView = lazy(() => import('./views/ContainersView'))
const SecurityView = lazy(() => import('./views/SecurityView'))
const LogsView = lazy(() => import('./views/LogsView'))
const NetworkView = lazy(() => import('./views/NetworkView'))
const StorageView = lazy(() => import('./views/StorageView'))
const BillingView = lazy(() => import('./views/BillingView'))
const CRMView = lazy(() => import('./views/CRMView'))
const EmailView = lazy(() => import('./views/EmailView'))
const SettingsView = lazy(() => import('./views/SettingsView'))

const viewComponents: Record<ViewId, React.LazyExoticComponent<React.ComponentType>> = {
  dashboard: DashboardView,
  websites: WebsitesView,
  domains: DomainsView,
  databases: DatabasesView,
  applications: ApplicationsView,
  agents: AgentsView,
  monitoring: MonitoringView,
  cicd: CICDView,
  ssl: SSLView,
  backups: BackupsView,
  servers: ServersView,
  containers: ContainersView,
  security: SecurityView,
  logs: LogsView,
  network: NetworkView,
  storage: StorageView,
  billing: BillingView,
  crm: CRMView,
  email: EmailView,
  settings: SettingsView,
}

function ViewLoader() {
  return (
    <div className="space-y-4 p-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}

function Sidebar() {
  const { activeView, sidebarCollapsed, setActiveView, toggleSidebar } = usePlatformStore()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const grouped = useMemo(() => {
    const groups: { name?: string; items: typeof NAV_ITEMS }[] = []
    let current: { name?: string; items: typeof NAV_ITEMS } = { items: [] }
    for (const item of NAV_ITEMS) {
      if (item.group && (!current.name || current.name !== item.group)) {
        if (current.items.length > 0) groups.push(current)
        current = { name: item.group, items: [] }
      }
      current.items.push(item)
    }
    if (current.items.length > 0) groups.push(current)
    return groups
  }, [])

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={`flex h-screen flex-col border-r border-gray-200 bg-gray-950 transition-all duration-300 ${
          sidebarCollapsed ? 'w-[68px]' : 'w-[260px]'
        }`}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-gray-800 px-4">
          <ALOLogoMark className="h-9 w-9 shrink-0" />
          {!sidebarCollapsed && (
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-bold text-white">ALO <span className="text-[#3B82F6]">Labs</span></span>
              <span className="text-[10px] text-gray-500">Cloud Platform</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 px-3 py-3">
          <nav className="space-y-5">
            {grouped.map((group) => (
              <div key={group.name || '_'}>
                {!sidebarCollapsed && group.name && (
                  <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    {group.name}
                  </p>
                )}
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = iconMap[item.icon] || LayoutDashboard
                    const active = activeView === item.id
                    const btn = (
                      <button
                        key={item.id}
                        onClick={() => setActiveView(item.id as ViewId)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          active
                            ? 'bg-[#E8501A]/20 text-purple-400'
                            : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                        }`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#E8501A]' : ''}`} />
                        {!sidebarCollapsed && <span>{item.label}</span>}
                      </button>
                    )
                    if (sidebarCollapsed) {
                      return (
                        <Tooltip key={item.id}>
                          <TooltipTrigger asChild>{btn}</TooltipTrigger>
                          <TooltipContent side="right" className="font-medium">
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      )
                    }
                    return btn
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* Bottom */}
        <div className="border-t border-gray-800 p-3">
          <div className={`flex items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <Avatar className="h-8 w-8 shrink-0 bg-[#E8501A]/30">
              <AvatarFallback className="bg-[#E8501A]/30 text-xs text-purple-400">
                {user?.name?.charAt(0)?.toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            {!sidebarCollapsed && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <span className="truncate text-sm font-medium text-gray-200">{user?.name || 'User'}</span>
                <span className="truncate text-xs text-gray-500">{user?.email}</span>
              </div>
            )}
          </div>
          <Separator className="my-3 bg-gray-800" />
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={logout}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-red-400"
                >
                  <LogOut className="h-4 w-4" />
                  {!sidebarCollapsed && <span>Sign Out</span>}
                </button>
              </TooltipTrigger>
              {sidebarCollapsed && <TooltipContent side="right">Sign Out</TooltipContent>}
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleSidebar}
                  className="flex items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
                >
                  {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              {sidebarCollapsed && <TooltipContent side="right">Expand Sidebar</TooltipContent>}
            </Tooltip>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}

function TopBar() {
  const { activeView, setCommandOpen } = usePlatformStore()
  const notifications = usePlatformStore((s) => s.notifications)
  const unreadCount = usePlatformStore((s) => s.unreadCount)
  const label = NAV_ITEMS.find((n) => n.id === activeView)?.label || 'Dashboard'

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setCommandOpen])

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-gray-900">{label}</h1>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setCommandOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-400 transition-colors hover:border-gray-300 hover:bg-gray-100"
        >
          <Command className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium sm:inline">⌘K</kbd>
        </button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="relative rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700">
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>Notifications</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  )
}

export default function AppShell() {
  const activeView = usePlatformStore((s) => s.activeView)
  const ActiveComponent = viewComponents[activeView]

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <Suspense fallback={<ViewLoader />}>
            <ActiveComponent />
          </Suspense>
        </main>
      </div>
    </div>
  )
}