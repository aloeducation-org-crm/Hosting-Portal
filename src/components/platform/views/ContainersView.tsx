'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Plus, Play, Square, RotateCcw, Trash2, Box, Cpu, MemoryStick, HardDrive, Network, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'

interface Container {
  id: string
  name: string
  image: string
  status: string
  port: number
  cpu: number
  memory: number
  disk: number
  network: { in: number; out: number }
  createdAt: string
}

const STATUS_CONFIG: Record<string, { label: string; className: string; accent: string }> = {
  running: { label: 'Running', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', accent: 'bg-emerald-500' },
  stopped: { label: 'Stopped', className: 'bg-gray-500/15 text-gray-600 border-gray-500/30', accent: 'bg-gray-300' },
  crashed: { label: 'Crashed', className: 'bg-red-500/15 text-red-700 border-red-500/30', accent: 'bg-red-500' },
  building: { label: 'Building', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30', accent: 'bg-amber-500' },
}

const IMAGE_PRESETS = [
  { value: 'nginx', label: 'nginx' },
  { value: 'node:20', label: 'node:20' },
  { value: 'python:3.12', label: 'python:3.12' },
  { value: 'redis:7', label: 'redis:7' },
  { value: 'postgres:16', label: 'postgres:16' },
  { value: 'mongo:7', label: 'mongo:7' },
]

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}
      </div>
    </div>
  )
}

function StatBar({ label, value, max, unit, icon: Icon }: {
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

export default function ContainersView() {
  const [containers, setContainers] = useState<Container[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', image: 'nginx', port: '8080' })

  const loadContainers = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/containers', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch containers')
      const data = await res.json()
      setContainers(data)
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
        const res = await fetch('/api/containers', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch containers')
        const data = await res.json()
        if (!cancelled) {
          setContainers(data)
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

  const handleCreate = async () => {
    const token = getToken()
    if (!token || !form.name.trim()) return
    try {
      const res = await fetch('/api/containers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: form.name, image: form.image, port: parseInt(form.port) || 8080 }),
      })
      if (!res.ok) throw new Error('Failed to create container')
      toast.success('Container created successfully')
      setCreateOpen(false)
      setForm({ name: '', image: 'nginx', port: '8080' })
      loadContainers()
    } catch {
      toast.error('Failed to create container')
    }
  }

  const handleAction = async (id: string, action: string) => {
    const token = getToken()
    if (!token) return

    const previousContainers = [...containers]
    setContainers((prev) => {
      const next = [...prev]
      const idx = next.findIndex((c) => c.id === id)
      if (idx === -1) return prev
      if (action === 'delete') {
        next.splice(idx, 1)
        return next
      }
      const statusMap: Record<string, string> = {
        start: 'running', stop: 'stopped', restart: 'building',
      }
      next[idx] = { ...next[idx]!, status: statusMap[action] || next[idx]!.status }
      return next
    })

    try {
      const res = await fetch(`/api/containers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error(`Failed to ${action} container`)
      toast.success(`Container ${action === 'restart' ? 'restart' : action + 'ed'} successfully`)
      if (action === 'restart') {
        setTimeout(() => {
          setContainers((prev) =>
            prev.map((c) => c.id === id ? { ...c, status: 'running' } : c)
          )
        }, 3000)
      }
    } catch {
      setContainers(previousContainers)
      toast.error(`Failed to ${action} container`)
    }
  }

  if (loading) return <div className="p-6"><LoadingSkeleton /></div>

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Containers</h2>
          <p className="text-sm text-gray-500 mt-1">Manage your Docker containers</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
          <Plus className="mr-2 h-4 w-4" /> Create Container
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
            <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); loadContainers() }} className="ml-auto">Retry</Button>
          </CardContent>
        </Card>
      )}

      {containers.length === 0 && !error ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Box className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-600">No containers yet</h3>
            <p className="text-sm text-gray-400 mt-1">Create your first container to get started</p>
            <Button onClick={() => setCreateOpen(true)} className="mt-4 bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
              <Plus className="mr-2 h-4 w-4" /> Create Container
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {containers.map((container) => {
            const statusConf = (STATUS_CONFIG[container.status] || STATUS_CONFIG.stopped)!
            return (
              <Card key={container.id} className="group border-gray-200 hover:border-[#E8501A]/30 transition-all hover:shadow-md overflow-hidden">
                <div className={`h-1 ${statusConf.accent}`} />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                        container.status === 'running' ? 'bg-emerald-500/10' :
                        container.status === 'crashed' ? 'bg-red-500/10' :
                        container.status === 'building' ? 'bg-amber-500/10' : 'bg-gray-100'
                      }`}>
                        <Box className={`h-5 w-5 ${
                          container.status === 'running' ? 'text-emerald-600' :
                          container.status === 'crashed' ? 'text-red-600' :
                          container.status === 'building' ? 'text-amber-600' : 'text-gray-400'
                        }`} />
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold">{container.name}</CardTitle>
                        <p className="text-xs text-gray-400 mt-0.5 font-mono">{container.image}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={statusConf.className}>
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                        container.status === 'running' ? 'bg-emerald-500 animate-pulse' :
                        container.status === 'building' ? 'bg-amber-500 animate-pulse' :
                        container.status === 'crashed' ? 'bg-red-500' : 'bg-gray-400'
                      }`} />
                      {statusConf.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Port</span>
                    <Badge variant="outline" className="font-mono">{container.port}</Badge>
                  </div>

                  <div className="space-y-2.5 pt-2 border-t border-gray-100">
                    <StatBar label="CPU" value={container.cpu} max={100} unit="%" icon={Cpu} />
                    <StatBar label="Memory" value={container.memory} max={100} unit="%" icon={MemoryStick} />
                    <StatBar label="Disk" value={container.disk} max={100} unit="%" icon={HardDrive} />
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500 flex items-center gap-1"><Network className="h-3 w-3" /> Network</span>
                        <span className="text-gray-600 font-medium">↓{container.network.in} MB ↑{container.network.out} MB</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100">
                    {container.status === 'running' ? (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-red-600" onClick={() => handleAction(container.id, 'stop')}>
                        <Square className="mr-1 h-3 w-3" /> Stop
                      </Button>
                    ) : container.status === 'stopped' || container.status === 'crashed' ? (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-emerald-600" onClick={() => handleAction(container.id, 'start')}>
                        <Play className="mr-1 h-3 w-3" /> Start
                      </Button>
                    ) : null}
                    {container.status === 'running' && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-amber-600" onClick={() => handleAction(container.id, 'restart')}>
                        <RotateCcw className="mr-1 h-3 w-3" /> Restart
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-red-600 ml-auto" onClick={() => handleAction(container.id, 'delete')}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Container</DialogTitle>
            <DialogDescription>Spin up a new Docker container.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="ctn-name">Name *</Label>
              <Input id="ctn-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-container" />
            </div>
            <div className="grid gap-2">
              <Label>Image</Label>
              <Select value={form.image} onValueChange={(v) => setForm({ ...form, image: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IMAGE_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ctn-port">Port</Label>
              <Input id="ctn-port" type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="8080" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              disabled={!form.name.trim()}
            >
              Create Container
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}