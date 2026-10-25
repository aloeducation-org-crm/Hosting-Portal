'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Globe,
  LayoutGrid,
  Database,
  Bot,
  ArrowUpRight,
  Activity,
  Cpu,
  HardDrive,
  Wifi,
  MemoryStick,
  Plus,
  Server,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { usePlatformStore } from '@/stores/usePlatformStore'

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

interface DashboardStats {
  user: { id: string; name: string; email: string; plan: string; role: string; createdAt: string }
  stats: { domains: number; activeWebsites: number; databases: number; applications: number; servers: number; crmContacts: number; aiAgentRuns: number; sslCerts: number }
}

interface ActivityItem {
  type: string
  title: string
  date: string
}

const STAT_CARDS = [
  { key: 'activeWebsites', label: 'Websites', icon: LayoutGrid, color: 'text-emerald-600', bg: 'bg-emerald-50', trend: 12 },
  { key: 'domains', label: 'Domains', icon: Globe, color: 'text-purple-600', bg: 'bg-purple-50', trend: 8 },
  { key: 'databases', label: 'Databases', icon: Database, color: 'text-orange-600', bg: 'bg-orange-50', trend: 5 },
  { key: 'applications', label: 'Applications', icon: Server, color: 'text-pink-600', bg: 'bg-pink-50', trend: 3 },
  { key: 'aiAgentRuns', label: 'AI Agent Runs', icon: Bot, color: 'text-orange-600', bg: 'bg-orange-50', trend: 24 },
  { key: 'uptime', label: 'Uptime', icon: Activity, color: 'text-teal-600', bg: 'bg-teal-50', trend: 0.2, isPercent: true },
]

const FALLBACK_RESOURCE_ITEMS = [
  { label: 'CPU', value: 34, icon: Cpu, color: 'bg-[#E8501A]' },
  { label: 'Memory', value: 58, icon: MemoryStick, color: 'bg-emerald-500' },
  { label: 'Disk', value: 22, icon: HardDrive, color: 'bg-amber-500' },
  { label: 'Bandwidth', value: 15, icon: Wifi, color: 'bg-rose-500' },
]

const ACTIVITY_ICONS: Record<string, typeof Globe> = {
  domain: Globe,
  website: LayoutGrid,
  crm: Clock,
  ai: Bot,
}

const ACTIVITY_COLORS: Record<string, string> = {
  domain: 'bg-purple-50 text-purple-600',
  website: 'bg-emerald-50 text-emerald-600',
  crm: 'bg-amber-50 text-amber-600',
  ai: 'bg-purple-50 text-purple-600',
}

export default function DashboardView() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [resourceMetrics, setResourceMetrics] = useState<{ cpu?: number; memory?: number; disk?: number; bandwidth?: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = getToken()
    if (!token) return

    async function fetchData() {
      try {
        setLoading(true)
        setError(null)

        const headers = { Authorization: `Bearer ${token}` }

        const [statsRes, activityRes, metricsRes] = await Promise.all([
          fetch('/api/dashboard/stats', { headers }),
          fetch('/api/dashboard/activity', { headers }),
          fetch('/api/monitoring/metrics', { headers }),
        ])

        if (!statsRes.ok || !activityRes.ok) {
          throw new Error('Failed to fetch dashboard data')
        }

        const statsData = await statsRes.json()
        const activityData = await activityRes.json()

        setStats(statsData)
        setActivities(activityData.activities || [])

        // Use monitoring metrics for resource bars if available
        if (metricsRes.ok) {
          try {
            const metricsData = await metricsRes.json()
            const m = metricsData.data ?? metricsData
            if (m && typeof m.cpu === 'number') {
              setResourceMetrics({
                cpu: m.cpu,
                memory: m.memory,
                disk: m.disk,
                bandwidth: m.bandwidth,
              })
            }
          } catch {
            // ignore metrics parse errors
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-1" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <Skeleton className="h-4 w-12" />
                </div>
                <Skeleton className="h-7 w-16 mb-1" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Failed to load dashboard</h3>
            <p className="text-sm text-gray-500 mb-4">{error}</p>
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="border-[#E8501A] text-[#E8501A] hover:bg-[#E8501A] hover:text-white"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const statValues = stats
    ? {
        activeWebsites: stats.stats.activeWebsites,
        domains: stats.stats.domains,
        databases: stats.stats.databases,
        applications: stats.stats.applications,
        aiAgentRuns: stats.stats.aiAgentRuns,
        uptime: 99.9,
      }
    : null

  const resourceItems = FALLBACK_RESOURCE_ITEMS.map((item) => {
    if (!resourceMetrics) return item
    const key = item.label.toLowerCase() as keyof typeof resourceMetrics
    const dynamicValue = resourceMetrics[key]
    if (dynamicValue !== undefined) {
      return { ...item, value: Math.min(100, Math.round(dynamicValue)) }
    }
    return item
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back{stats?.user?.name ? `, ${stats.user.name}` : ''} 👋
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Here&apos;s an overview of your cloud hosting environment.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {STAT_CARDS.map((card) => {
          const Icon = card.icon
          const value = statValues ? (statValues as Record<string, number>)[card.key] ?? 0 : 0
          const displayValue = card.isPercent ? `${value}%` : value

          return (
            <Card
              key={card.key}
              className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200 group cursor-default"
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className={`h-9 w-9 rounded-lg ${card.bg} flex items-center justify-center group-hover:scale-110 transition-transform duration-200`}>
                    <Icon className={`h-5 w-5 ${card.color}`} />
                  </div>
                  {card.trend > 0 && (
                    <Badge variant="secondary" className="text-xs font-medium text-emerald-700 bg-emerald-50 border-0 px-1.5 py-0">
                      <ArrowUpRight className="h-3 w-3 mr-0.5" />
                      {card.trend}%
                    </Badge>
                  )}
                </div>
                <div className="text-2xl font-bold text-gray-900">{displayValue}</div>
                <div className="text-xs text-gray-500 mt-0.5">{card.label}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Resource Usage + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Resource Usage */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#E8501A]" />
              Resource Usage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {resourceItems.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-700">{item.label}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{item.value}%</span>
                  </div>
                  <Progress value={item.value} className="h-2" />
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#E8501A]" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="h-8 w-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No recent activity</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                {activities.slice(0, 5).map((item, index) => {
                  const Icon = ACTIVITY_ICONS[item.type] || Globe
                  const colorClass = ACTIVITY_COLORS[item.type] || 'bg-gray-50 text-gray-600'
                  return (
                    <div
                      key={index}
                      className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{item.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
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

      {/* Quick Actions */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#E8501A]" />
            Quick Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'New Website', icon: LayoutGrid, desc: 'Launch a new website project', view: 'websites' as const },
              { label: 'New Domain', icon: Globe, desc: 'Register a new domain name', view: 'domains' as const },
              { label: 'New Database', icon: Database, desc: 'Create a managed database', view: 'databases' as const },
              { label: 'New App', icon: Server, desc: 'Deploy a new application', view: 'applications' as const },
            ].map((action) => {
              const Icon = action.icon
              return (
                <Button
                  key={action.label}
                  variant="outline"
                  onClick={() => usePlatformStore.getState().setActiveView(action.view)}
                  className="h-auto p-4 border-dashed border-gray-300 hover:border-[#E8501A] hover:bg-[#E8501A]/5 flex items-start gap-3 justify-start group transition-all duration-200"
                >
                  <div className="h-10 w-10 rounded-lg bg-[#E8501A]/10 flex items-center justify-center group-hover:bg-[#E8501A]/20 transition-colors shrink-0">
                    <Icon className="h-5 w-5 text-[#E8501A]" />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-gray-800 group-hover:text-[#E8501A] transition-colors">
                      {action.label}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{action.desc}</div>
                  </div>
                </Button>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}