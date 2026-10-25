'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Cpu, MemoryStick, HardDrive, Wifi, RefreshCw, Activity,
  Clock, AlertTriangle, CheckCircle, Info, Zap, ArrowDown, ArrowUp,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface MetricEvent {
  id: string
  type: string
  message: string
  severity: string
  timestamp: string
}

interface Metrics {
  cpu: number
  memory: number
  diskIo: number
  networkIo: number
  uptime: number
  activeConnections: number
  responseTimes: number[]
  events: MetricEvent[]
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, unit, max, color, sub }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  unit: string
  max: number
  color: string
  sub?: string
}) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <Card className="border-gray-200 hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${color}`}>
              <Icon className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="text-sm font-medium text-gray-500">{label}</span>
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-bold text-gray-900">{value}</span>
          <span className="text-sm text-gray-400">{unit}</span>
        </div>
        <Progress value={pct} className="mt-3 h-2" />
        <div className="mt-1.5 text-xs text-gray-400">{sub || `${pct}% of ${max}${unit}`}</div>
      </CardContent>
    </Card>
  )
}

export default function MonitoringView() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadMetrics = async (showRefresh = false) => {
    const token = getToken()
    if (!token) return
    if (showRefresh) setRefreshing(true)
    try {
      const res = await fetch('/api/monitoring/metrics', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch metrics')
      setMetrics(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = getToken()
      if (!token) return
      try {
        const res = await fetch('/api/monitoring/metrics', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch metrics')
        const data = await res.json()
        if (!cancelled) {
          setMetrics(data)
          setError(null)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unknown error')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const SEVERITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
    success: CheckCircle, warning: AlertTriangle, error: AlertTriangle, info: Info,
  }
  const SEVERITY_COLOR: Record<string, string> = {
    success: 'text-emerald-500', warning: 'text-amber-500', error: 'text-red-500', info: 'text-purple-500',
  }

  if (loading) return <div className="p-6"><LoadingSkeleton /></div>

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Monitoring</h2>
          <p className="text-sm text-gray-500 mt-1">Real-time system performance and health metrics</p>
        </div>
        <Button onClick={() => loadMetrics(true)} variant="outline" className="gap-2" disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {metrics && (
        <>
          {/* Metric Cards */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Cpu} label="CPU Usage" value={metrics.cpu} unit="%" max={100} color="bg-[#E8501A]" />
            <MetricCard icon={MemoryStick} label="Memory Usage" value={metrics.memory} unit="%" max={100} color="bg-amber-500" />
            <MetricCard icon={HardDrive} label="Disk I/O" value={metrics.diskIo} unit="MB/s" max={100} color="bg-emerald-500" />
            <MetricCard icon={Wifi} label="Network I/O" value={metrics.networkIo} unit="Mbps" max={500} color="bg-sky-500" sub="Inbound + Outbound" />
          </div>

          {/* Uptime & Active Connections */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-gray-200">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-emerald-500" />
                  <CardTitle className="text-sm font-semibold text-gray-700">Uptime — Last 30 Days</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-4xl font-bold text-emerald-600">{metrics.uptime}%</div>
                <p className="text-xs text-gray-400">Service Level Agreement target: 99.9%</p>
                <div className="flex gap-0.5 h-4 rounded overflow-hidden">
                  {Array.from({ length: 30 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-sm bg-emerald-500"
                      title={`Day ${i + 1}: Up`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" /> Up</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-red-400" /> Down</span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-gray-200">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#E8501A]" />
                  <CardTitle className="text-sm font-semibold text-gray-700">Active Connections</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-4">
                <div className="relative h-32 w-32">
                  <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="#f3f4f6" strokeWidth="10" />
                    <circle
                      cx="60" cy="60" r="52" fill="none" stroke="#E8501A" strokeWidth="10"
                      strokeDasharray={`${Math.min(metrics.activeConnections / 2000, 1) * 326.7} 326.7`}
                      strokeLinecap="round"
                      className="transition-all duration-1000"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-gray-900">{metrics.activeConnections.toLocaleString()}</span>
                    <span className="text-xs text-gray-400">/ 2,000 max</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">Real-time connections</p>
              </CardContent>
            </Card>
          </div>

          {/* Response Time Chart */}
          <Card className="border-gray-200">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-sm font-semibold text-gray-700">Response Time — Last 24 Hours</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-1.5 h-48">
                {metrics.responseTimes.map((ms, i) => {
                  const h = Math.max(8, (ms / 200) * 100)
                  const isNow = i === metrics.responseTimes.length - 1
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[9px] text-gray-400 font-medium">{ms}</span>
                      <div
                        className={`w-full rounded-t-sm transition-all duration-500 ${isNow ? 'bg-[#E8501A]' : ms > 120 ? 'bg-amber-400/70' : 'bg-[#E8501A]/40 hover:bg-[#E8501A]/60'}`}
                        style={{ height: `${h}%` }}
                        title={`${i}:00 — ${ms}ms`}
                      />
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between text-[9px] text-gray-400 mt-2 px-1">
                <span>24h ago</span>
                <span>18h</span>
                <span>12h</span>
                <span>6h</span>
                <span>Now</span>
              </div>
            </CardContent>
          </Card>

          {/* Events Log */}
          <Card className="border-gray-200">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-gray-500" />
                <CardTitle className="text-sm font-semibold text-gray-700">Recent Events</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="max-h-80 overflow-y-auto">
              <div className="space-y-2">
                {metrics.events.map((event) => {
                  const Icon = SEVERITY_ICON[event.severity] || Info
                  return (
                    <div key={event.id} className="flex items-start gap-3 rounded-lg bg-gray-50 p-3 hover:bg-gray-100 transition-colors">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${SEVERITY_COLOR[event.severity] || 'text-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700">{event.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-gray-400 border-gray-200">
                            {event.type}
                          </Badge>
                          <span className="text-[11px] text-gray-400">{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}