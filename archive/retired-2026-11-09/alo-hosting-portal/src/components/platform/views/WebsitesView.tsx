'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  Plus,
  ExternalLink,
  Trash2,
  LayoutGrid,
  Code2,
  Globe,
  AlertCircle,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

interface Website {
  id: string
  name: string
  type: string
  status: string
  publishedUrl: string | null
  createdAt: string
  updatedAt: string
  domain?: { id: string; name: string; status: string } | null
}

const TYPE_CONFIG: Record<string, { label: string; icon: typeof LayoutGrid; color: string }> = {
  builder: { label: 'Builder', icon: LayoutGrid, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  wordpress: { label: 'WordPress', icon: Globe, color: 'bg-purple-50 text-purple-700 border-purple-200' },
  custom: { label: 'Custom', icon: Code2, color: 'bg-purple-50 text-purple-700 border-purple-200' },
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  building: { label: 'Building', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  suspended: { label: 'Suspended', className: 'bg-red-50 text-red-700 border-red-200' },
  archived: { label: 'Archived', className: 'bg-gray-50 text-gray-500 border-gray-200' },
}

export default function WebsitesView() {
  const router = useRouter()
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null

  const [websites, setWebsites] = useState<Website[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState('builder')
  const [creating, setCreating] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Website | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadWebsites = async () => {
    if (!token) return
    try {
      const res = await fetch('/api/websites', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch websites')
      const data = await res.json()
      setWebsites(data.websites || [])
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
        const res = await fetch('/api/websites', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch websites')
        const data = await res.json()
        if (!cancelled) {
          setWebsites(data.websites || [])
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
      const res = await fetch('/api/websites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: createName.trim(), type: createType }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create website')
      }
      toast.success('Website created successfully')
      setCreateName('')
      setCreateType('builder')
      setCreateOpen(false)
      loadWebsites()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create website')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || !token) return
    try {
      setDeleting(true)
      const res = await fetch(`/api/websites/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to delete website')
      }
      toast.success('Website deleted')
      setDeleteTarget(null)
      loadWebsites()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete website')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-10 w-36 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-0 shadow-sm">
              <CardContent className="p-5">
                <Skeleton className="h-5 w-32 mb-3" />
                <div className="flex gap-2 mb-4">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-40 mb-1" />
                <Skeleton className="h-3 w-24" />
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
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Failed to load websites</h3>
            <p className="text-sm text-gray-500 mb-4">{error}</p>
            <Button
              variant="outline"
              onClick={loadWebsites}
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
          <h1 className="text-2xl font-bold text-gray-900">Websites</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your hosted websites</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white gap-2">
              <Plus className="h-4 w-4" />
              Create Website
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Website</DialogTitle>
              <DialogDescription>
                Set up a new website. You can configure it further after creation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="website-name">Website Name</Label>
                <Input
                  id="website-name"
                  placeholder="e.g. My Portfolio"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <div className="space-y-2">
                <Label>Website Type</Label>
                <Select value={createType} onValueChange={setCreateType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="builder">Builder</SelectItem>
                    <SelectItem value="wordpress">WordPress</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
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
                {creating ? 'Creating...' : 'Create Website'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Content */}
      {websites.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-12 text-center">
            <div className="h-16 w-16 rounded-2xl bg-[#E8501A]/10 flex items-center justify-center mx-auto mb-4">
              <LayoutGrid className="h-8 w-8 text-[#E8501A]" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No websites yet</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-sm mx-auto">
              Create your first website and get it live in minutes with our powerful hosting platform.
            </p>
            <Button
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white gap-2"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Create Website
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {websites.map((website) => {
            const typeConf = (TYPE_CONFIG[website.type] || TYPE_CONFIG.builder)!
            const statusConf = (STATUS_CONFIG[website.status] || STATUS_CONFIG.building)!
            const TypeIcon = typeConf.icon

            return (
              <Card
                key={website.id}
                className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200 group"
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-[#E8501A]/10 flex items-center justify-center group-hover:bg-[#E8501A]/20 transition-colors">
                        <TypeIcon className="h-5 w-5 text-[#E8501A]" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 text-sm">{website.name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {format(new Date(website.createdAt), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-4">
                    <Badge variant="outline" className={typeConf.color}>
                      {typeConf.label}
                    </Badge>
                    <Badge variant="outline" className={statusConf.className}>
                      {statusConf.label}
                    </Badge>
                  </div>

                  {website.domain?.name && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-4">
                      <Globe className="h-3.5 w-3.5" />
                      <span>{website.domain.name}</span>
                      {website.publishedUrl && (
                        <a
                          href={website.publishedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-[#E8501A] hover:underline flex items-center gap-1"
                        >
                          Visit <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  )}

                  {!website.domain?.name && (
                    <div className="text-xs text-gray-400 mb-4">No domain connected</div>
                  )}

                  <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-gray-600 hover:text-[#E8501A] hover:bg-[#E8501A]/5"
                      onClick={() => router.push(`/dashboard/websites/${website.id}/edit`)}
                    >
                      Manage
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 ml-auto"
                      onClick={() => setDeleteTarget(website)}
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

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Website</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? This action cannot be undone.
              All website data will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}