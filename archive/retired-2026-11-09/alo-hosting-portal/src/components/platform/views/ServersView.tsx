'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Plus, Play, Square, RotateCcw, Trash2, Terminal, Server as ServerIcon,
  Cpu, MemoryStick, HardDrive, Globe, Network, Copy,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'

interface VpsServer {
  id: string
  name: string
  hostname: string
  ip: string
  os: string
  plan: string
  cpuCores: number
  memoryMb: number
  diskGb: number
  bandwidthTb: number
  status: string
  sshUser: string
  sshPort: number
  uptime: number
  createdAt: string
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  stopped: { label: 'Stopped', className: 'bg-gray-500/15 text-gray-600 border-gray-500/30' },
  restarting: { label: 'Restarting', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  provisioning: { label: 'Provisioning', className: 'bg-purple-500/15 text-purple-700 border-purple-500/30' },
}

const OS_CONFIG: Record<string, { label: string; color: string }> = {
  'ubuntu-24.04': { label: 'Ubuntu 24.04', color: 'bg-orange-500/10 text-orange-700 border-orange-500/20' },
  'ubuntu-22.04': { label: 'Ubuntu 22.04', color: 'bg-orange-500/10 text-orange-700 border-orange-500/20' },
  'debian-12': { label: 'Debian 12', color: 'bg-red-500/10 text-red-700 border-red-500/20' },
  'centos-9': { label: 'CentOS 9', color: 'bg-sky-500/10 text-sky-700 border-sky-500/20' },
  'fedora-40': { label: 'Fedora 40', color: 'bg-purple-500/10 text-purple-700 border-purple-500/20' },
}

const PLAN_CONFIG: Record<string, { label: string; color: string }> = {
  'vps-1': { label: 'VPS-1', color: 'bg-gray-100 text-gray-600 border-gray-200' },
  'vps-2': { label: 'VPS-2', color: 'bg-purple-500/10 text-purple-700 border-purple-500/20' },
  'vps-4': { label: 'VPS-4', color: 'bg-[#E8501A]/10 text-[#E8501A] border-[#E8501A]/20' },
  'vps-8': { label: 'VPS-8', color: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
      </div>
    </div>
  )
}

function ResourceBar({ label, value, max, unit, icon: Icon }: {
  label: string; value: number; max: number; unit: string;
  icon: React.ComponentType<{ className?: string }>
}) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 flex items-center gap-1"><Icon className="h-3 w-3" /> {label}</span>
        <span className="text-gray-600 font-medium">{value} {unit}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-[#E8501A]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function ServersView() {
  const [servers, setServers] = useState<VpsServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    name: '', hostname: '', os: 'ubuntu-24.04', plan: 'vps-1', sshPort: '22',
  })

  // Resource usage from monitoring API
  const [usage, setUsage] = useState<Record<string, { cpu: number; mem: number; disk: number }>>({})
  const [metricsAvailable, setMetricsAvailable] = useState(false)

  const loadServers = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/servers', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setServers(data)
      // Only set random fallback if no metrics API data has been received
      if (!metricsAvailable) {
        const u: Record<string, { cpu: number; mem: number; disk: number }> = {}
        for (const s of data) {
          u[s.id] = {
            cpu: Math.round(10 + Math.random() * 50),
            mem: Math.round(20 + Math.random() * 50),
            disk: Math.round(15 + Math.random() * 40),
          }
        }
        setUsage(u)
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = getToken()
      if (!token) return
      try {
        const res = await fetch('/api/servers', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        if (!cancelled) {
          setServers(data)
          // Only set random fallback if no metrics API data has been received
          if (!metricsAvailable) {
            const u: Record<string, { cpu: number; mem: number; disk: number }> = {}
            for (const s of data) {
              u[s.id] = {
                cpu: Math.round(10 + Math.random() * 50),
                mem: Math.round(20 + Math.random() * 50),
                disk: Math.round(15 + Math.random() * 40),
              }
            }
            setUsage(u)
          }
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

  // Fetch real metrics from monitoring API on mount and every 10 seconds
  useEffect(() => {
    const token = getToken()
    if (!token) return

    let cancelled = false
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/monitoring/metrics', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const rawData = await res.json()
        const m = rawData.data ?? rawData
        if (cancelled) return
        if (typeof m.cpu === 'number' && typeof m.memory === 'number' && typeof m.disk === 'number') {
          setMetricsAvailable(true)
          setUsage((prev) => {
            // Apply real metrics to all servers that have entries
            const next = { ...prev }
            for (const key of Object.keys(next)) {
              next[key] = {
                cpu: Math.round(m.cpu),
                mem: Math.round(m.memory),
                disk: Math.round(m.disk),
              }
            }
            return next
          })
        }
      } catch {
        // Silently ignore metrics fetch errors
      }
    }
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 10000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  // Simulate provisioning → running
  useEffect(() => {
    const provisioning = servers.filter((s) => s.status === 'provisioning')
    if (provisioning.length === 0) return
    const timers = provisioning.map((s) =>
      setTimeout(() => {
        setServers((prev) => prev.map((srv) => srv.id === s.id ? { ...srv, status: 'running' } : srv))
      }, 4000 + Math.random() * 3000)
    )
    return () => timers.forEach(clearTimeout)
  }, [servers])

  const handleCreate = async () => {
    const token = getToken()
    if (!token || !form.name.trim() || !form.hostname.trim()) return
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Failed to create server')
      setCreateOpen(false)
      setForm({ name: '', hostname: '', os: 'ubuntu-24.04', plan: 'vps-1', sshPort: '22' })
      loadServers()
    } catch {
      setError('Failed to create server')
    }
  }

  const handleAction = async (id: string, action: string) => {
    const token = getToken()
    if (!token) return

    // Optimistic UI update
    const previousServers = [...servers]
    setServers((prev) => {
      const next = [...prev]
      const idx = next.findIndex((s) => s.id === id)
      if (idx === -1) return prev
      if (action === 'delete') {
        next.splice(idx, 1)
        return next
      }
      const statusMap: Record<string, string> = {
        start: 'running', stop: 'stopped', restart: 'restarting',
      }
      next[idx] = { ...next[idx]!, status: statusMap[action] || next[idx]!.status }
      return next
    })

    try {
      if (action === 'delete') {
        const res = await fetch(`/api/servers?id=${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to delete server')
        toast.success('Server deleted successfully')
      } else {
        const res = await fetch('/api/servers', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id, action }),
        })
        if (!res.ok) throw new Error(`Failed to ${action} server`)
        toast.success(`Server ${action}ed successfully`)
      }
    } catch {
      // Revert on error
      setServers(previousServers)
      toast.error(`Failed to ${action} server`)
    }

    if (action === 'restart') {
      setTimeout(() => {
        setServers((prev) =>
          prev.map((s) => s.id === id ? { ...s, status: 'running' } : s)
        )
      }, 3000)
    }
  }

  const copyIp = (ip: string) => {
    navigator.clipboard.writeText(ip).catch(() => {})
  }

  if (loading) return <div className="p-6"><LoadingSkeleton /></div>

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">VPS / Servers</h2>
          <p className="text-sm text-gray-500 mt-1">Manage your virtual private servers</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
          <Plus className="mr-2 h-4 w-4" /> Create Server
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {servers.length === 0 && !error ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ServerIcon className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-600">No servers yet</h3>
            <p className="text-sm text-gray-400 mt-1">Create your first VPS to get started</p>
            <Button onClick={() => setCreateOpen(true)} className="mt-4 bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
              <Plus className="mr-2 h-4 w-4" /> Create Server
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {servers.map((server) => {
            const statusConf = (STATUS_CONFIG[server.status] || STATUS_CONFIG.stopped)!
            const osConf = (OS_CONFIG[server.os] || OS_CONFIG['ubuntu-24.04'])!
            const planConf = (PLAN_CONFIG[server.plan] || PLAN_CONFIG['vps-1'])!
            const u = usage[server.id]
            return (
              <Card key={server.id} className="group border-gray-200 hover:border-[#E8501A]/30 transition-all hover:shadow-md overflow-hidden">
                {/* Top accent */}
                <div className={`h-1 ${
                  server.status === 'running' ? 'bg-emerald-500' :
                  server.status === 'provisioning' ? 'bg-purple-500' :
                  server.status === 'restarting' ? 'bg-amber-500' : 'bg-gray-300'
                }`} />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                        server.status === 'running' ? 'bg-emerald-500/10' :
                        server.status === 'provisioning' ? 'bg-purple-500/10' : 'bg-gray-100'
                      }`}>
                        <ServerIcon className={`h-5 w-5 ${
                          server.status === 'running' ? 'text-emerald-600' :
                          server.status === 'provisioning' ? 'text-purple-600' : 'text-gray-400'
                        }`} />
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold">{server.name}</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5">{server.hostname}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={statusConf.className}>
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                        server.status === 'running' ? 'bg-emerald-500 animate-pulse' :
                        server.status === 'provisioning' ? 'bg-purple-500 animate-pulse' :
                        server.status === 'restarting' ? 'bg-amber-500 animate-pulse' : 'bg-gray-400'
                      }`} />
                      {statusConf.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* IP & Badges */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => copyIp(server.ip)}
                      className="flex items-center gap-1.5 text-sm font-mono text-gray-600 hover:text-[#E8501A] transition-colors group/ip"
                    >
                      <Globe className="h-3.5 w-3.5 text-gray-400" />
                      {server.ip}
                      <Copy className="h-3 w-3 text-gray-300 group-hover/ip:text-[#E8501A]" />
                    </button>
                    <div className="flex gap-1.5">
                      <Badge variant="outline" className={osConf.color}>{osConf.label}</Badge>
                      <Badge variant="outline" className={planConf.color}>{planConf.label}</Badge>
                    </div>
                  </div>

                  {/* Specs Grid */}
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="rounded-lg bg-gray-50 p-2">
                      <p className="text-xs text-gray-400">CPU</p>
                      <p className="text-sm font-semibold text-gray-700">{server.cpuCores}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-2">
                      <p className="text-xs text-gray-400">RAM</p>
                      <p className="text-sm font-semibold text-gray-700">{server.memoryMb >= 1024 ? `${server.memoryMb / 1024} GB` : `${server.memoryMb} MB`}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-2">
                      <p className="text-xs text-gray-400">Disk</p>
                      <p className="text-sm font-semibold text-gray-700">{server.diskGb} GB</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-2">
                      <p className="text-xs text-gray-400">Bandwidth</p>
                      <p className="text-sm font-semibold text-gray-700">{server.bandwidthTb} TB</p>
                    </div>
                  </div>

                  {/* Resource Usage */}
                  {u && server.status === 'running' && (
                    <div className="space-y-2.5 pt-2 border-t border-gray-100">
                      <ResourceBar label="CPU" value={u.cpu} max={100} unit="%" icon={Cpu} />
                      <ResourceBar label="Memory" value={u.mem} max={100} unit="%" icon={MemoryStick} />
                      <ResourceBar label="Disk" value={u.disk} max={100} unit="%" icon={HardDrive} />
                    </div>
                  )}

                  {/* Uptime */}
                  {server.uptime > 0 && (
                    <p className="text-xs text-gray-400">
                      Uptime: {Math.floor(server.uptime / 3600)}h {Math.floor((server.uptime % 3600) / 60)}m
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100">
                    {server.status === 'running' ? (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-red-600" onClick={() => handleAction(server.id, 'stop')}>
                        <Square className="mr-1 h-3 w-3" /> Stop
                      </Button>
                    ) : server.status === 'stopped' ? (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-emerald-600" onClick={() => handleAction(server.id, 'start')}>
                        <Play className="mr-1 h-3 w-3" /> Start
                      </Button>
                    ) : null}
                    {server.status === 'running' && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-amber-600" onClick={() => handleAction(server.id, 'restart')}>
                        <RotateCcw className="mr-1 h-3 w-3" /> Restart
                      </Button>
                    )}
                    <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-gray-700" disabled>
                          <Terminal className="mr-1 h-3 w-3" /> Console
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Console is not available in this environment</TooltipContent>
                    </Tooltip>
                    </TooltipProvider>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-red-600 ml-auto" onClick={() => handleAction(server.id, 'delete')}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Server Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Server</DialogTitle>
            <DialogDescription>Provision a new virtual private server.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="srv-name">Name *</Label>
                <Input id="srv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-server" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="srv-hostname">Hostname *</Label>
                <Input id="srv-hostname" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} placeholder="server01.alolabs.app" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Operating System</Label>
              <Select value={form.os} onValueChange={(v) => setForm({ ...form, os: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ubuntu-24.04">Ubuntu 24.04 LTS</SelectItem>
                  <SelectItem value="ubuntu-22.04">Ubuntu 22.04 LTS</SelectItem>
                  <SelectItem value="debian-12">Debian 12</SelectItem>
                  <SelectItem value="centos-9">CentOS 9</SelectItem>
                  <SelectItem value="fedora-40">Fedora 40</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Plan</Label>
              <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vps-1">VPS-1: 1 Core / 1 GB / 25 GB</SelectItem>
                  <SelectItem value="vps-2">VPS-2: 2 Cores / 2 GB / 50 GB</SelectItem>
                  <SelectItem value="vps-4">VPS-4: 4 Cores / 4 GB / 100 GB</SelectItem>
                  <SelectItem value="vps-8">VPS-8: 8 Cores / 8 GB / 200 GB</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ssh-port">SSH Port</Label>
              <Input id="ssh-port" type="number" value={form.sshPort} onChange={(e) => setForm({ ...form, sshPort: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              disabled={!form.name.trim() || !form.hostname.trim()}
            >
              Create Server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}