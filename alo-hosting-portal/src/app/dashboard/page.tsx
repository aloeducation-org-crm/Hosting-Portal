'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Globe,
  Monitor,
  Users,
  Bot,
  Search,
  Plus,
  UserPlus,
  Play,
  ArrowRight,
  TrendingUp,
  Clock,
} from 'lucide-react'

interface Stats {
  domains: number
  activeWebsites: number
  crmContacts: number
  aiAgentRuns: number
}

interface UserInfo {
  name: string
  email: string
  plan: string
  role: string
  createdAt: string
}

interface ActivityItem {
  type: string
  title: string
  date: string
}

const statCards = [
  {
    key: 'domains' as const,
    label: 'Total Domains',
    icon: Globe,
    color: '#E8501A',
    bgColor: '#FFF7ED',
    href: '/dashboard/domains',
  },
  {
    key: 'activeWebsites' as const,
    label: 'Active Websites',
    icon: Monitor,
    color: '#059669',
    bgColor: '#ECFDF5',
    href: '/dashboard/websites',
  },
  {
    key: 'crmContacts' as const,
    label: 'CRM Contacts',
    icon: Users,
    color: '#D97706',
    bgColor: '#FFFBEB',
    href: '/dashboard/crm',
  },
  {
    key: 'aiAgentRuns' as const,
    label: 'AI Agent Runs',
    icon: Bot,
    color: '#DC2626',
    bgColor: '#FEF2F2',
    href: '/dashboard/agents',
  },
]

const quickActions = [
  {
    label: 'Search Domain',
    icon: Search,
    href: '/dashboard/domains',
    color: '#E8501A',
  },
  {
    label: 'Create Website',
    icon: Plus,
    href: '/dashboard/websites',
    color: '#059669',
  },
  {
    label: 'Add CRM Contact',
    icon: UserPlus,
    href: '/dashboard/crm',
    color: '#D97706',
  },
  {
    label: 'Run AI Agent',
    icon: Play,
    href: '/dashboard/agents',
    color: '#DC2626',
  },
]

const activityIcons: Record<string, typeof Globe> = {
  domain: Globe,
  website: Monitor,
  crm: Users,
  ai: Bot,
}

const activityColors: Record<string, string> = {
  domain: '#E8501A',
  website: '#059669',
  crm: '#D97706',
  ai: '#DC2626',
}

const planColors: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700 border-gray-200',
  starter: 'bg-blue-50 text-blue-700 border-blue-200',
  premium: 'bg-amber-50 text-amber-700 border-amber-200',
  business: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function DashboardOverview() {
  const { user, token } = useAuthStore()
  const [stats, setStats] = useState<Stats | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` }

        const [statsRes, activityRes] = await Promise.all([
          fetch('/api/dashboard/stats', { headers }),
          fetch('/api/dashboard/activity', { headers }),
        ])

        if (!cancelled && statsRes.ok) {
          const data = await statsRes.json()
          setStats(data.stats)
          setUserInfo(data.user)
        }

        if (!cancelled && activityRes.ok) {
          const data = await activityRes.json()
          setActivities(data.activities)
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch dashboard data:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const displayName = userInfo?.name || user?.name || 'User'
  const plan = userInfo?.plan || user?.plan || 'free'

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B]">
            Welcome back, {displayName?.split(' ')[0]} 👋
          </h1>
          <p className="text-[#475569] mt-1">
            Here&apos;s what&apos;s happening with your projects today.
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'text-xs font-semibold px-3 py-1.5 capitalize',
            planColors[plan] || planColors.free
          )}
        >
          <TrendingUp className="h-3.5 w-3.5 mr-1" />
          {plan} Plan
        </Badge>
      </div>

      {/* Stats Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-0 overflow-hidden">
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-3" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => {
            const Icon = card.icon
            return (
              <Link key={card.key} href={card.href}>
                <Card className="p-0 overflow-hidden hover:shadow-md transition-shadow group cursor-pointer border-[#E2E8F0]">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-[#475569]">
                          {card.label}
                        </p>
                        <p className="text-3xl font-bold text-[#1E293B] mt-2">
                          {stats?.[card.key] ?? 0}
                        </p>
                      </div>
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
                        style={{ backgroundColor: card.bgColor }}
                      >
                        <Icon
                          className="h-5 w-5"
                          style={{ color: card.color }}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center text-xs text-[#9CA3AF] group-hover:text-[#E8501A] transition-colors">
                      <span>View details</span>
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {/* Quick Actions */}
      <Card className="border-[#E2E8F0] p-0 overflow-hidden">
        <CardHeader className="pb-0">
          <CardTitle className="text-base font-semibold text-[#1E293B]">
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {quickActions.map((action) => {
              const Icon = action.icon
              return (
                <Link key={action.label} href={action.href}>
                  <button className="w-full flex flex-col items-center gap-2.5 rounded-xl border border-[#E2E8F0] bg-white p-4 hover:bg-[#FFF7ED] hover:border-[#E8501A]/30 transition-all group">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF7ED] group-hover:bg-[#E8501A] transition-colors"
                    >
                      <Icon
                        className="h-5 w-5 text-[#E8501A] group-hover:text-white transition-colors"
                      />
                    </div>
                    <span className="text-xs font-medium text-[#1E293B]">
                      {action.label}
                    </span>
                  </button>
                </Link>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card className="border-[#E2E8F0] p-0 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-0">
          <CardTitle className="text-base font-semibold text-[#1E293B]">
            Recent Activity
          </CardTitle>
          <Clock className="h-4 w-4 text-[#9CA3AF]" />
        </CardHeader>
        <CardContent className="pt-2">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-full max-w-sm" />
                    <Skeleton className="h-3 w-16 mt-1" />
                  </div>
                </div>
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF7ED] mb-3">
                <Clock className="h-6 w-6 text-[#E8501A]" />
              </div>
              <p className="text-sm font-medium text-[#1E293B]">
                No activity yet
              </p>
              <p className="text-xs text-[#9CA3AF] mt-1">
                Start by searching for a domain or creating a website.
              </p>
            </div>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {activities.slice(0, 5).map((activity, i) => {
                const Icon = activityIcons[activity.type] || Globe
                const color = activityColors[activity.type] || '#475569'
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[#FFF7ED]/50 transition-colors"
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${color}15` }}
                    >
                      <Icon
                        className="h-4 w-4"
                        style={{ color }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1E293B] truncate">
                        {activity.title}
                      </p>
                      <p className="text-xs text-[#9CA3AF]">
                        {formatDate(activity.date)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

