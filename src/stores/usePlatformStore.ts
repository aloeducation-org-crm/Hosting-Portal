import { create } from 'zustand'

export type ViewId =
  | 'dashboard'
  | 'websites'
  | 'domains'
  | 'databases'
  | 'applications'
  | 'containers'
  | 'servers'
  | 'agents'
  | 'monitoring'
  | 'cicd'
  | 'ssl'
  | 'backups'
  | 'security'
  | 'logs'
  | 'network'
  | 'storage'
  | 'billing'
  | 'marketing'
  | 'operator'
  | 'crm'
  | 'email'
  | 'settings'

interface NotificationItem {
  id: string
  title: string
  message: string
  type: string
  read: boolean
  createdAt: string
}

interface PlatformState {
  activeView: ViewId
  sidebarCollapsed: boolean
  notifications: NotificationItem[]
  unreadCount: number
  commandOpen: boolean

  setActiveView: (view: ViewId) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setNotifications: (n: NotificationItem[]) => void
  setCommandOpen: (v: boolean) => void
}

export const usePlatformState = create<PlatformState>((set) => ({
  activeView: 'dashboard',
  sidebarCollapsed: false,
  notifications: [],
  unreadCount: 0,
  commandOpen: false,

  setActiveView: (view) => set({ activeView: view }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setNotifications: (n) =>
    set({ notifications: n, unreadCount: n.filter((x) => !x.read).length }),
  setCommandOpen: (v) => set({ commandOpen: v }),
}))

export const usePlatformStore = usePlatformState

export const NAV_ITEMS: {
  id: ViewId
  label: string
  icon: string
  group?: string
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'websites', label: 'Websites', icon: 'Globe', group: 'Hosting' },
  { id: 'domains', label: 'Domains', icon: 'Link2', group: 'Hosting' },
  { id: 'databases', label: 'Databases', icon: 'Database', group: 'Hosting' },
  { id: 'applications', label: 'Applications', icon: 'Box', group: 'Hosting' },
  { id: 'containers', label: 'Containers', icon: 'Container', group: 'Hosting' },
  { id: 'servers', label: 'VPS / Servers', icon: 'Server', group: 'Hosting' },
  { id: 'agents', label: 'AI Agents', icon: 'Bot', group: 'AI & DevOps' },
  { id: 'operator', label: 'Bill Agent AI', icon: 'Cpu', group: 'AI & DevOps' },
  { id: 'monitoring', label: 'Monitoring', icon: 'Activity', group: 'AI & DevOps' },
  { id: 'cicd', label: 'CI/CD', icon: 'GitBranch', group: 'AI & DevOps' },
  { id: 'ssl', label: 'SSL Certificates', icon: 'ShieldCheck', group: 'AI & DevOps' },
  { id: 'backups', label: 'Backups', icon: 'HardDrive', group: 'AI & DevOps' },
  { id: 'security', label: 'Security', icon: 'Shield', group: 'Platform' },
  { id: 'logs', label: 'Logs', icon: 'ScrollText', group: 'Platform' },
  { id: 'network', label: 'Network', icon: 'Network', group: 'Platform' },
  { id: 'storage', label: 'Storage', icon: 'FolderOpen', group: 'Platform' },
  { id: 'billing', label: 'Billing', icon: 'CreditCard', group: 'Business' },
  { id: 'marketing', label: 'Digital Marketing', icon: 'Megaphone', group: 'Business' },
  { id: 'crm', label: 'CRM', icon: 'Users', group: 'Business' },
  { id: 'email', label: 'Email', icon: 'Mail', group: 'Business' },
  { id: 'settings', label: 'Settings', icon: 'Settings', group: 'Business' },
]