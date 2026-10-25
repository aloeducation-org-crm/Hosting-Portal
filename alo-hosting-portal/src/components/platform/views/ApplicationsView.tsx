'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Plus, Play, Square, RotateCw, Trash2, Terminal, ExternalLink,
  Cpu, HardDrive, MemoryStick, Clock, Container,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface Deployment {
  id: string
  version: string
  status: string
  commit: string
  commitMessage: string
  branch: string
  triggeredBy: string
  duration: number
  startedAt: string
  completedAt: string | null
}

interface App {
  id: string
  name: string
  description: string | null
  type: string
  status: string
  imageUrl: string | null
  gitUrl: string | null
  branch: string
  port: number
  cpu: string
  memory: string
  disk: string
  url: string | null
  uptime: number
  lastDeployed: string | null
  createdAt: string
  deployments: Deployment[]
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  stopped: { label: 'Stopped', className: 'bg-gray-500/15 text-gray-600 border-gray-500/30' },
  building: { label: 'Building', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  crashed: { label: 'Crashed', className: 'bg-red-500/15 text-red-700 border-red-500/30' },
  deploying: { label: 'Deploying', className: 'bg-purple-500/15 text-purple-700 border-purple-500/30' },
}

const TYPE_COLORS: Record<string, string> = {
  docker: 'bg-sky-500/10 text-sky-700 border-sky-500/20',
  node: 'bg-lime-500/10 text-lime-700 border-lime-500/20',
  python: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
  static: 'bg-purple-500/10 text-purple-700 border-purple-500/20',
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export default function ApplicationsView() {
  const [apps, setApps] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deployOpen, setDeployOpen] = useState(false)
  const [logsApp, setLogsApp] = useState<App | null>(null)
  const [appLogs, setAppLogs] = useState<string | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', description: '', type: 'docker', gitUrl: '', branch: 'main',
    imageUrl: '', port: '3000', cpu: '0.5', memory: '512', disk: '1024',
  })

  const loadApps = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/applications', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch')
      setApps(await res.json())
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
        const res = await fetch('/api/applications', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        if (!cancelled) {
          setApps(data)
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

  // Fetch logs from API when a log dialog is opened
  useEffect(() => {
    if (!logsApp) {
      setAppLogs(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setLogsLoading(true)
      setAppLogs(null)
      const token = getToken()
      if (!token) {
        setLogsLoading(false)
        return
      }
      try {
        const res = await fetch(`/api/applications/${logsApp.id}/logs`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok && !cancelled) {
          const rawData = await res.json()
          const d = rawData.data ?? rawData
          if (typeof d === 'string') {
            setAppLogs(d)
          } else if (d?.logs && typeof d.logs === 'string') {
            setAppLogs(d.logs)
          } else if (d?.output && typeof d.output === 'string') {
            setAppLogs(d.output)
          }
        }
      } catch {
        // Silently ignore — will show "No logs available"
      } finally {
        if (!cancelled) setLogsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [logsApp?.id])

  const handleDeploy = async () => {
    const token = getToken()
    if (!token || !form.name.trim()) return
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Deploy failed')
      setDeployOpen(false)
      setForm({ name: '', description: '', type: 'docker', gitUrl: '', branch: 'main', imageUrl: '', port: '3000', cpu: '0.5', memory: '512', disk: '1024' })
      loadApps()
    } catch {
      setError('Failed to deploy application')
    }
  }

  const handleAction = async (id: string, action: string) => {
    const token = getToken()
    if (!token) return
    try {
      if (action === 'delete') {
        const res = await fetch(`/api/applications/${id}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error()
        setApps((prev) => prev.filter((a) => a.id !== id))
      } else if (action === 'start' || action === 'stop') {
        const res = await fetch(`/api/applications/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: action === 'start' ? 'running' : 'stopped' }),
        })
        if (!res.ok) throw new Error()
        setApps((prev) =>
          prev.map((a) => a.id === id ? { ...a, status: action === 'start' ? 'running' : 'stopped' } : a)
        )
      } else if (action === 'redeploy') {
        setApps((prev) =>
          prev.map((a) => a.id === id ? { ...a, status: 'deploying' } : a)
        )
      }
    } catch {
      setError(`Failed to ${action}`)
    }
  }

  if (loading) return <div className="p-6"><LoadingSkeleton /></div>

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Applications</h2>
          <p className="text-sm text-gray-500 mt-1">Manage your deployed containers and services</p>
        </div>
        <Button onClick={() => setDeployOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
          <Plus className="mr-2 h-4 w-4" /> Deploy New
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {apps.length === 0 && !error ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Container className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-600">No applications yet</h3>
            <p className="text-sm text-gray-400 mt-1">Deploy your first application to get started</p>
            <Button onClick={() => setDeployOpen(true)} className="mt-4 bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
              <Plus className="mr-2 h-4 w-4" /> Deploy New
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {apps.map((app) => {
            const statusConf = (STATUS_CONFIG[app.status] || STATUS_CONFIG.stopped)!
            return (
              <Card key={app.id} className="group relative overflow-hidden border border-gray-200 hover:border-[#E8501A]/30 transition-all hover:shadow-md">
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${app.status === 'running' ? 'bg-emerald-500' : app.status === 'deploying' || app.status === 'building' ? 'bg-amber-500' : app.status === 'crashed' ? 'bg-red-500' : 'bg-gray-400'}`} />
                <CardHeader className="pb-3 pl-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base font-semibold">{app.name}</CardTitle>
                      <Badge variant="outline" className={TYPE_COLORS[app.type] || ''}>
                        {app.type}
                      </Badge>
                    </div>
                    <Badge variant="outline" className={statusConf.className}>
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${app.status === 'running' ? 'bg-emerald-500 animate-pulse' : app.status === 'crashed' ? 'bg-red-500' : app.status === 'deploying' || app.status === 'building' ? 'bg-amber-500 animate-pulse' : 'bg-gray-400'}`} />
                      {statusConf.label}
                    </Badge>
                  </div>
                  {app.description && <p className="text-xs text-gray-400 mt-1 truncate">{app.description}</p>}
                </CardHeader>
                <CardContent className="pl-5 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-gray-500">
                      <Cpu className="h-3 w-3" /> {app.cpu} vCPU
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-500">
                      <MemoryStick className="h-3 w-3" /> {app.memory} MB
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-500">
                      <HardDrive className="h-3 w-3" /> {Number(app.disk) >= 1024 ? `${(Number(app.disk) / 1024).toFixed(1)} GB` : `${app.disk} MB`}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {app.lastDeployed ? formatDistanceToNow(new Date(app.lastDeployed), { addSuffix: true }) : 'Never'}
                    </span>
                    {app.url && (
                      <a href={`https://${app.url}`} target="_blank" rel="noreferrer" className="text-[#E8501A] hover:underline flex items-center gap-1">
                        {app.url} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100">
                    {app.status === 'running' ? (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-red-600" onClick={() => handleAction(app.id, 'stop')}>
                        <Square className="mr-1 h-3 w-3" /> Stop
                      </Button>
                    ) : app.status === 'stopped' ? (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-emerald-600" onClick={() => handleAction(app.id, 'start')}>
                        <Play className="mr-1 h-3 w-3" /> Start
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-purple-600" onClick={() => handleAction(app.id, 'redeploy')}>
                      <RotateCw className="mr-1 h-3 w-3" /> Redeploy
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-gray-700" onClick={() => setLogsApp(app)}>
                      <Terminal className="mr-1 h-3 w-3" /> Logs
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-red-600 ml-auto" onClick={() => handleAction(app.id, 'delete')}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Deploy Dialog */}
      <Dialog open={deployOpen} onOpenChange={setDeployOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deploy New Application</DialogTitle>
            <DialogDescription>Configure and deploy a new application container.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="app-name">Name *</Label>
              <Input id="app-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-awesome-app" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-desc">Description</Label>
              <Textarea id="app-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional description" rows={2} />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="docker">Docker</SelectItem>
                  <SelectItem value="node">Node.js</SelectItem>
                  <SelectItem value="python">Python</SelectItem>
                  <SelectItem value="static">Static Site</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="git-url">Git URL</Label>
              <Input id="git-url" value={form.gitUrl} onChange={(e) => setForm({ ...form, gitUrl: e.target.value })} placeholder="https://github.com/user/repo" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="branch">Branch</Label>
                <Input id="branch" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="port">Port</Label>
                <Input id="port" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
              </div>
            </div>
            {form.type === 'docker' && (
              <div className="grid gap-2">
                <Label htmlFor="image-url">Docker Image URL</Label>
                <Input id="image-url" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="node:18-alpine" />
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label>CPU</Label>
                <Select value={form.cpu} onValueChange={(v) => setForm({ ...form, cpu: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.5">0.5 vCPU</SelectItem>
                    <SelectItem value="1">1 vCPU</SelectItem>
                    <SelectItem value="2">2 vCPU</SelectItem>
                    <SelectItem value="4">4 vCPU</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Memory</Label>
                <Select value={form.memory} onValueChange={(v) => setForm({ ...form, memory: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="512">512 MB</SelectItem>
                    <SelectItem value="1024">1 GB</SelectItem>
                    <SelectItem value="2048">2 GB</SelectItem>
                    <SelectItem value="4096">4 GB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Disk</Label>
                <Select value={form.disk} onValueChange={(v) => setForm({ ...form, disk: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1024">1 GB</SelectItem>
                    <SelectItem value="5120">5 GB</SelectItem>
                    <SelectItem value="10240">10 GB</SelectItem>
                    <SelectItem value="20480">20 GB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeployOpen(false)}>Cancel</Button>
            <Button onClick={handleDeploy} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white" disabled={!form.name.trim()}>
              Deploy Application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs Dialog */}
      <Dialog open={!!logsApp} onOpenChange={() => setLogsApp(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Logs — {logsApp?.name}</DialogTitle>
          </DialogHeader>
          <div className="bg-gray-950 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-xs text-gray-300 space-y-1">
            {logsLoading ? (
              <div className="flex items-center gap-2 text-gray-500">
                <div className="h-3 w-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                Loading logs...
              </div>
            ) : appLogs ? (
              appLogs.split('\n').map((line, i) => (
                <p key={i} className="text-gray-300">{line || '\u00A0'}</p>
              ))
            ) : (
              <p className="text-gray-500">No logs available.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}