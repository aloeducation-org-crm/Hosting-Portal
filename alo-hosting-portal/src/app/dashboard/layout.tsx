'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  LayoutDashboard,
  Globe,
  Monitor,
  Bot,
  Users,
  Mail,
  CreditCard,
  Settings,
  Search,
  Bell,
  Menu,
  X,
  LogOut,
  User,
  ChevronRight,
  Zap,
  MessageSquare,
} from 'lucide-react'

const navItems = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Domains', href: '/dashboard/domains', icon: Globe },
  { label: 'Websites', href: '/dashboard/websites', icon: Monitor },
  { label: 'AI Agents', href: '/dashboard/agents', icon: Bot },
  { label: 'CRM', href: '/dashboard/crm', icon: Users },
  { label: 'Email', href: '/dashboard/email', icon: Mail },
  { label: 'Billing', href: '/dashboard/billing', icon: CreditCard },
  { label: 'Settings', href: '/dashboard/settings', icon: Settings },
  { label: 'Webchat', href: '/dashboard/webchat', icon: MessageSquare },
]

function useAuthRedirect() {
  const { isAuthenticated, isLoading, checkSession } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    checkSession()
  }, [checkSession])

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/')
    }
  }, [isLoading, isAuthenticated, router])

  return { isAuthenticated, isLoading }
}

function Sidebar({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const pathname = usePathname()
  const { user, logout } = useAuthStore()
  const router = useRouter()

  const handleLogout = useCallback(() => {
    logout()
    router.replace('/')
  }, [logout, router])

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U'

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 flex h-full w-64 flex-col bg-white border-r border-[#E2E8F0] transition-transform duration-200 ease-in-out lg:static lg:z-auto lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 px-5 border-b border-[#E2E8F0]">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8501A]">
            <Zap className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="text-lg font-bold text-[#1E293B] tracking-tight">
            ALO Labs
          </span>
          <button
            onClick={onClose}
            className="ml-auto lg:hidden p-1 rounded-md hover:bg-[#FFF7ED] transition-colors"
          >
            <X className="h-5 w-5 text-[#475569]" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-[#E8501A] text-white shadow-sm'
                    : 'text-[#475569] hover:bg-[#FFF7ED] hover:text-[#E8501A]'
                )}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" />
                <span className="flex-1">{item.label}</span>
                {active && <ChevronRight className="h-4 w-4 opacity-70" />}
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-[#E2E8F0] p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-[#FFF7ED] text-[#E8501A] text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#1E293B] truncate">
                {user?.name || 'User'}
              </p>
              <p className="text-xs text-[#9CA3AF] truncate">
                {user?.email || ''}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[#475569] hover:bg-red-50 hover:text-red-600 transition-colors mt-1"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}

function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuthStore()
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U'

  const handleLogout = useCallback(() => {
    logout()
    router.replace('/')
  }, [logout, router])

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-[#E2E8F0] bg-white/80 backdrop-blur-sm px-4 md:px-6">
      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-md hover:bg-[#FFF7ED] transition-colors"
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5 text-[#1E293B]" />
      </button>

      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
        <Input
          placeholder="Search domains, websites, contacts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchQuery.trim()) {
              toast.info(`Search: ${searchQuery.trim()} — global search coming soon`)
            }
          }}
          className="pl-9 bg-[#FFF7ED]/50 border-[#E2E8F0] focus-visible:ring-[#E8501A]/20 h-9 text-sm"
        />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="relative text-[#475569] hover:text-[#E8501A] hover:bg-[#FFF7ED]"
          aria-label="Notifications"
          onClick={() => toast.info('Notifications coming soon')}
        >
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#E8501A]" />
        </Button>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 px-2 hover:bg-[#FFF7ED]"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-[#E8501A] text-white text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden md:inline text-sm font-medium text-[#1E293B] max-w-32 truncate">
                {user?.name || 'User'}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-[#9CA3AF]">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push('/dashboard/settings')}
              className="cursor-pointer"
            >
              <User className="mr-2 h-4 w-4" />
              Profile settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              variant="destructive"
              className="cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isAuthenticated, isLoading } = useAuthRedirect()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFF7ED]">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8501A] animate-pulse">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <div className="min-h-screen flex bg-[#F9F8FC]">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}