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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  HardDrive, Plus, RotateCcw, Database, FileArchive, Server,
  Globe, Clock, CheckCircle, XCircle, Loader2, AlertCircle,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

interface Backup {
  id: string
  name: string
  type: string
  target: string
  sizeMb: number
  status: string
  createdAt: string
  schedule: string | null
}

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  completed: { label: 'Completed', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', icon: CheckCircle },
  running: { label: 'Running', className: 'bg-purple-500/15 text-purple-700 border-purple-500/30', icon: Loader2 },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-700 border-red-500/30', icon: XCircle },
  pending: { label: 'Pending', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30', icon: AlertCircle },
}

const TYPE_CONFIG: Record<string, { label: string; className: string }> = {
  full: { label: 'Full', className: 'bg-purple-500/10 text-purple-700 border-purple-500/20' },
  incremental: { label: 'Incremental', className: 'bg-sky-500/10 text-sky-700 border-sky-500/20' },
  database: { label: 'Database', className: 'bg-amber-500/10 text-amber-700 border-amber-500/20' },
  files: { label: 'Files', className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
}

const TARGET_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  website: Globe, database: Database, application: FileArchive, server: Server,
}

function formatSize(mb: number) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

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
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}

export default function BackupsView() {
  const [backups, setBackups] = useState<Backup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<Backup | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [form, setForm] = useState({
    name: '', type: 'full', target: 'website', schedule: '',
  })

  const loadBackups = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/backups', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch')
      setBackups(await res.json())
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
        const res = await fetch('/api/backups', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        if (!cancelled) {
          setBackups(data)
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
      const res = await fetch('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Failed to create backup')
      setCreateOpen(false)
      setForm({ name: '', type: 'full', target: 'website', schedule: '' })
      loadBackups()
    } catch {
      setError('Failed to create backup')
    }
  }

  const handleRestore = async () => {
    if (!restoreTarget) return
    const token = getToken()
    if (!token) return
    setRestoring(true)
    try {
      const res = await fetch('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'restore', backupId: restoreTarget.id }),
      })
      if (!res.ok) throw new Error('Failed to restore backup')
      toast.success('Backup restored successfully')
      setRestoreTarget(null)
      loadBackups()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to restore backup')
    } finally {
      setRestoring(false)
    }
  }

  const totalSize = backups.reduce((sum, b) => sum + b.sizeMb, 0)
  const storageLimit = 10240 // 10 GB
  const storagePct = Math.min(100, Math.round((totalSize / storageLimit) * 100))

  if (loading) return <div className="p-6"><LoadingSkeleton /></div>

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Backups</h2>
          <p className="text-sm text-gray-500 mt-1">Manage your backup snapshots and restoration</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
          <Plus className="mr-2 h-4 w-4" /> Create Backup
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {/* Storage Usage */}
      <Card className="border-gray-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-[#E8501A]" />
              <span className="text-sm font-medium text-gray-700">Storage Usage</span>
            </div>
            <span className="text-sm text-gray-500">{formatSize(totalSize)} / {formatSize(storageLimit)}</span>
          </div>
          <Progress value={storagePct} className="h-2.5" />
          <p className="text-xs text-gray-400 mt-1">{storagePct}% of allocated storage used</p>
        </CardContent>
      </Card>

      {/* Backup Table */}
      <Card className="border-gray-200">
        <CardContent className="p-0">
          {backups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Database className="h-12 w-12 text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-600">No backups yet</h3>
              <p className="text-sm text-gray-400 mt-1">Create your first backup to protect your data</p>
              <Button onClick={() => setCreateOpen(true)} className="mt-4 bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
                <Plus className="mr-2 h-4 w-4" /> Create Backup
              </Button>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((backup) => {
                    const statusConf = (STATUS_CONFIG[backup.status] || STATUS_CONFIG.pending)!
                    const typeConf = (TYPE_CONFIG[backup.type] || TYPE_CONFIG.full)!
                    const TargetIcon = TARGET_ICONS[backup.target] || Globe
                    return (
                      <TableRow key={backup.id} className="hover:bg-gray-50">
                        <TableCell>
                          <div>
                            <span className="font-medium text-sm">{backup.name}</span>
                            {backup.schedule && (
                              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                                <Clock className="h-3 w-3" /> {backup.schedule}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={typeConf.className}>{typeConf.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm text-gray-600 capitalize">
                            <TargetIcon className="h-3.5 w-3.5 text-gray-400" />
                            {backup.target}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">{formatSize(backup.sizeMb)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusConf.className}>
                            <statusConf.icon className={`mr-1 h-3 w-3 ${backup.status === 'running' ? 'animate-spin' : ''}`} />
                            {statusConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-gray-400">
                          {formatDistanceToNow(new Date(backup.createdAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell className="text-right">
                          {backup.status === 'completed' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs text-[#E8501A] hover:text-[#5B2FC9] hover:bg-[#E8501A]/5"
                              onClick={() => setRestoreTarget(backup)}
                            >
                              <RotateCcw className="mr-1 h-3 w-3" /> Restore
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Backup</DialogTitle>
            <DialogDescription>Create a new backup snapshot of your data.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="backup-name">Backup Name *</Label>
              <Input
                id="backup-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="daily-backup-jul"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full</SelectItem>
                    <SelectItem value="incremental">Incremental</SelectItem>
                    <SelectItem value="database">Database</SelectItem>
                    <SelectItem value="files">Files</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Target</Label>
                <Select value={form.target} onValueChange={(v) => setForm({ ...form, target: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="website">Website</SelectItem>
                    <SelectItem value="database">Database</SelectItem>
                    <SelectItem value="application">Application</SelectItem>
                    <SelectItem value="server">Server</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="schedule">Schedule (optional cron)</Label>
              <Input
                id="schedule"
                value={form.schedule}
                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                placeholder="0 2 * * * (daily at 2 AM)"
              />
              <p className="text-xs text-gray-400">Leave empty for a one-time backup</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white" disabled={!form.name.trim()}>
              Create Backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Confirmation */}
      <Dialog open={!!restoreTarget} onOpenChange={() => setRestoreTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restore Backup</DialogTitle>
            <DialogDescription>
              Are you sure you want to restore from <strong>{restoreTarget?.name}</strong>? This action may overwrite current data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button onClick={handleRestore} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white" disabled={restoring}>
              {restoring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Restore Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}