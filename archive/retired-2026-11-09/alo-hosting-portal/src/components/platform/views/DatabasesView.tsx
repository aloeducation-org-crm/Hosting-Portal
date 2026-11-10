'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Database,
  Plus,
  Copy,
  Trash2,
  AlertCircle,
  Server,
  User,
  HardDrive,
  CheckCircle2,
  Loader2,
  Table2,
  RotateCcw,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

interface HostedDatabase {
  id: string
  name: string
  type: string
  version: string
  status: string
  host: string
  port: number
  username: string
  password: string
  sizeMb: number
  usedMb: number
  createdAt: string
  updatedAt: string
}

const TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  postgresql: { label: 'PostgreSQL', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', icon: '🐘' },
  mysql: { label: 'MySQL', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', icon: '🐬' },
  mongodb: { label: 'MongoDB', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: '🍃' },
  redis: { label: 'Redis', color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: '⚡' },
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  creating: { label: 'Creating', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  paused: { label: 'Paused', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  deleted: { label: 'Deleted', className: 'bg-red-50 text-red-700 border-red-200' },
}

function formatSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

export default function DatabasesView() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null

  const [databases, setDatabases] = useState<HostedDatabase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState('postgresql')
  const [createSize, setCreateSize] = useState('256')
  const [creating, setCreating] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<HostedDatabase | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [manageTarget, setManageTarget] = useState<HostedDatabase | null>(null)

  const loadDatabases = async () => {
    if (!token) return
    try {
      const res = await fetch('/api/databases', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch databases')
      const data = await res.json()
      setDatabases(Array.isArray(data) ? data : [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) return
      try {
        const res = await fetch('/api/databases', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch databases')
        const data = await res.json()
        if (!cancelled) {
          setDatabases(Array.isArray(data) ? data : [])
          setError(null)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Something went wrong')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleCreate = async () => {
    if (!createName.trim() || !token) return
    try {
      setCreating(true)
      const res = await fetch('/api/databases', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: createName.trim(),
          type: createType,
          sizeMb: parseInt(createSize, 10),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create database')
      }
      toast.success('Database created successfully')
      setCreateName('')
      setCreateType('postgresql')
      setCreateSize('256')
      setCreateOpen(false)
      loadDatabases()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create database')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || !token) return
    try {
      setDeleting(true)
      const res = await fetch(`/api/databases/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete database')
      }
      toast.success('Database deleted')
      setDeleteTarget(null)
      loadDatabases()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete database')
    } finally {
      setDeleting(false)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`${label} copied to clipboard`)
    }).catch(() => {
      toast.error('Failed to copy')
    })
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-10 w-40 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-5">
                <Skeleton className="h-5 w-32 mb-3" />
                <div className="flex gap-2 mb-4">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </CardContent>
            </Card>
          ))}
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
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Failed to load databases</h3>
            <p className="text-sm text-gray-500 mb-4">{error}</p>
            <Button
              variant="outline"
              onClick={loadDatabases}
              className="border-[#E8501A] text-[#E8501A] hover:bg-[#E8501A] hover:text-white"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Databases</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your hosted databases</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white gap-2">
              <Plus className="h-4 w-4" />
              Create Database
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Database</DialogTitle>
              <DialogDescription>
                Provision a managed database instance. Connection details will be provided after creation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="db-name">Database Name</Label>
                <Input
                  id="db-name"
                  placeholder="e.g. my-app-production"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <div className="space-y-2">
                <Label>Database Type</Label>
                <Select value={createType} onValueChange={setCreateType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postgresql">🐘 PostgreSQL</SelectItem>
                    <SelectItem value="mysql">🐬 MySQL</SelectItem>
                    <SelectItem value="mongodb">🍃 MongoDB</SelectItem>
                    <SelectItem value="redis">⚡ Redis</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Storage Size</Label>
                <Select value={createSize} onValueChange={setCreateSize}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="256">256 MB</SelectItem>
                    <SelectItem value="512">512 MB</SelectItem>
                    <SelectItem value="1024">1 GB</SelectItem>
                    <SelectItem value="2048">2 GB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
                onClick={handleCreate}
                disabled={!createName.trim() || creating}
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  'Create Database'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Content */}
      {databases.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-12 text-center">
            <div className="h-16 w-16 rounded-2xl bg-[#E8501A]/10 flex items-center justify-center mx-auto mb-4">
              <Database className="h-8 w-8 text-[#E8501A]" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No databases yet</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
              Create a managed database to store your application data with automatic backups and high availability.
            </p>
            <Button
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white gap-2"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Create Database
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {databases.map((db) => {
            const typeConf = (TYPE_CONFIG[db.type] || TYPE_CONFIG.postgresql)!
            const statusConf = (STATUS_CONFIG[db.status] || STATUS_CONFIG.active)!
            const usagePercent = db.sizeMb > 0 ? Math.round((db.usedMb / db.sizeMb) * 100) : 0
            const connString = `${db.host}:${db.port}`

            return (
              <Card
                key={db.id}
                className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200 group"
              >
                <CardContent className="p-5 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-[#E8501A]/10 flex items-center justify-center group-hover:bg-[#E8501A]/20 transition-colors text-lg">
                        {typeConf.icon}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 text-sm">{db.name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          v{db.version} &middot; Created {format(new Date(db.createdAt), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={typeConf.bg + ' ' + typeConf.color}>
                      {typeConf.label}
                    </Badge>
                    <Badge variant="outline" className={statusConf.className}>
                      {statusConf.label}
                    </Badge>
                  </div>

                  {/* Storage Usage */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-gray-500">Storage</span>
                      <span className="text-xs font-medium text-gray-700">
                        {formatSize(db.usedMb)} / {formatSize(db.sizeMb)}
                      </span>
                    </div>
                    <Progress value={usagePercent} className="h-1.5" />
                  </div>

                  {/* Connection Info */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-2">
                      <Server className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <code className="text-xs text-gray-600 font-mono flex-1 truncate">
                        {connString}
                      </code>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-gray-400 hover:text-[#E8501A]"
                              onClick={() => copyToClipboard(connString, 'Connection string')}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copy connection string</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <code className="text-xs text-gray-600 font-mono flex-1 truncate">
                        {db.username}
                      </code>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-gray-400 hover:text-[#E8501A]"
                              onClick={() => copyToClipboard(db.username, 'Username')}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copy username</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <code className="text-xs text-gray-500 font-mono flex-1 truncate">
                        {db.password}
                      </code>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-gray-400 hover:text-[#E8501A]"
                              onClick={() => copyToClipboard(db.password, 'Password')}
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Copy password</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-gray-600 hover:text-[#E8501A] hover:bg-[#E8501A]/5"
                      onClick={() => setManageTarget(db)}
                    >
                      <Table2 className="h-3.5 w-3.5 mr-1.5" />
                      Manage
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-gray-600 hover:text-[#E8501A] hover:bg-[#E8501A]/5"
                      onClick={() => toast.info('Database restart is not available for SQLite — use the server restart instead.')}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      Restart
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 ml-auto"
                      onClick={() => setDeleteTarget(db)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Manage Dialog */}
      <Dialog open={!!manageTarget} onOpenChange={(open) => !open && setManageTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Database: {manageTarget?.name}</DialogTitle>
            <DialogDescription>Connection details and credentials</DialogDescription>
          </DialogHeader>
          {manageTarget && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Connection String</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-gray-100 rounded-md px-3 py-2 truncate">
                    {manageTarget.host}:{manageTarget.port}
                  </code>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => copyToClipboard(`${manageTarget.host}:${manageTarget.port}`, 'Connection string')}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Username</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-gray-100 rounded-md px-3 py-2 truncate">
                    {manageTarget.username}
                  </code>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => copyToClipboard(manageTarget.username, 'Username')}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-gray-100 rounded-md px-3 py-2 truncate">
                    {manageTarget.password}
                  </code>
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => copyToClipboard(manageTarget.password, 'Password')}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Database</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action cannot be undone.
              All data stored in this database will be permanently lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete Database'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}