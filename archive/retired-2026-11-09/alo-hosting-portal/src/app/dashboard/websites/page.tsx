'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import {
  Plus,
  Monitor,
  Trash2,
  ExternalLink,
  Pencil,
  Loader2,
  Globe,
  FileCode,
  ShoppingBag,
  LayoutTemplate,
  Newspaper,
  MoreHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Website {
  id: string
  name: string
  type: string
  status: string
  htmlContent: string | null
  publishedUrl: string | null
  domainId: string | null
  domain: { id: string; name: string; status: string } | null
  lastPublishedAt: string | null
  createdAt: string
  updatedAt: string
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  builder: { label: 'Builder', icon: LayoutTemplate },
  wordpress: { label: 'WordPress', icon: Globe },
  custom: { label: 'Custom', icon: FileCode },
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  building: 'bg-amber-100 text-amber-700 border-amber-200',
  suspended: 'bg-red-100 text-red-700 border-red-200',
  archived: 'bg-gray-100 text-gray-600 border-gray-200',
}

const THUMBNAIL_GRADIENTS = [
  'linear-gradient(135deg, #E8501A 0%, #a855f7 50%, #c084fc 100%)',
  'linear-gradient(135deg, #E8501A 0%, #7c3aed 50%, #0A5CFF 100%)',
  'linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #d946ef 100%)',
  'linear-gradient(135deg, #0A5CFF 0%, #6366f1 50%, #E8501A 100%)',
  'linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f43f5e 100%)',
  'linear-gradient(135deg, #E8501A 0%, #3b82f6 50%, #06b6d4 100%)',
]

function getGradient(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  return THUMBNAIL_GRADIENTS[Math.abs(hash) % THUMBNAIL_GRADIENTS.length]
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function WebsitesListPage() {
  const router = useRouter()
  const { token } = useAuthStore()
  const [websites, setWebsites] = useState<Website[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Website | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/websites', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (!cancelled && data.success) setWebsites(data.data ?? data.websites ?? [])
      } catch (err) {
        console.error('Failed to fetch websites:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/websites/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setWebsites((prev) => prev.filter((w) => w.id !== deleteTarget.id))
        setDeleteTarget(null)
      }
    } catch (err) {
      console.error('Failed to delete website:', err)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8501A]/10">
            <Monitor className="h-5 w-5 text-[#E8501A]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1E293B]">My Websites</h1>
            <p className="text-sm text-[#475569]">
              Manage and build your websites
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/dashboard/websites/new')}
          className="bg-[#E8501A] hover:bg-[#C73D12] text-white shrink-0"
        >
          <Plus className="mr-2 h-4 w-4" />
          New Website
        </Button>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden border-gray-100">
              <Skeleton className="h-40 w-full" />
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex gap-2">
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 flex-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && websites.length === 0 && (
        <Card className="border-dashed border-2 border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FFF7ED] mb-4">
              <Globe className="h-8 w-8 text-[#E8501A]" />
            </div>
            <h3 className="text-lg font-semibold text-[#1E293B] mb-1">
              No websites yet
            </h3>
            <p className="text-sm text-[#475569] max-w-sm mb-6">
              Create your first website with AI! Describe what you want and let our AI build it for you.
            </p>
            <Button
              onClick={() => router.push('/dashboard/websites/new')}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Website
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Website Grid */}
      {!loading && websites.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {websites.map((website) => {
            const typeConfig = (TYPE_CONFIG[website.type] || TYPE_CONFIG.builder)!
            const TypeIcon = typeConfig.icon
            return (
              <Card
                key={website.id}
                className="overflow-hidden border border-gray-100 bg-white transition-all duration-200 hover:border-[#E8501A]/30 hover:shadow-md"
              >
                {/* Thumbnail */}
                <div className="relative h-40 overflow-hidden bg-gray-50">
                  {website.htmlContent ? (
                    <iframe
                      srcDoc={website.htmlContent}
                      sandbox="allow-scripts"
                      className="pointer-events-none w-full h-full border-0 scale-[0.35] origin-top-left"
                      style={{ width: '285.7%', height: '285.7%' }}
                      title={website.name}
                    />
                  ) : (
                    <div
                      className="h-full w-full flex items-center justify-center"
                      style={{ background: getGradient(website.id) }}
                    >
                      <Globe className="h-12 w-12 text-white/60" />
                    </div>
                  )}
                  {/* Status badge overlay */}
                  <div className="absolute top-3 right-3">
                    <Badge variant="outline" className={STATUS_STYLES[website.status] || STATUS_STYLES.building}>
                      {website.status}
                    </Badge>
                  </div>
                </div>

                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[#1E293B] truncate text-base">
                        {website.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="outline" className="text-[10px] capitalize text-[#475569] border-gray-200 gap-1">
                          <TypeIcon className="h-3 w-3" />
                          {typeConfig.label}
                        </Badge>
                        {website.domain && (
                          <Badge variant="outline" className="text-[10px] text-[#475569] border-gray-200 gap-1">
                            <Globe className="h-3 w-3" />
                            {website.domain.name}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-[#475569] hover:text-[#1E293B]">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => router.push(`/dashboard/websites/${website.id}/edit`)}
                          className="cursor-pointer"
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        {website.status === 'active' && website.htmlContent && (
                          <DropdownMenuItem
                            onClick={() => {
                              const win = window.open('', '_blank')
                              if (win) {
                                win.document.write(website.htmlContent!)
                                win.document.close()
                              }
                            }}
                            className="cursor-pointer"
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            View
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(website)}
                          className="cursor-pointer text-red-600 focus:text-red-600"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <p className="text-xs text-[#9CA3AF] mb-4">
                    Updated {formatDate(website.updatedAt)}
                    {website.lastPublishedAt && ` · Published ${formatDate(website.lastPublishedAt)}`}
                  </p>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-sm"
                      onClick={() => router.push(`/dashboard/websites/${website.id}/edit`)}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    {website.status === 'active' && website.htmlContent && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-sm"
                        onClick={() => {
                          const win = window.open('', '_blank')
                          if (win) {
                            win.document.write(website.htmlContent!)
                            win.document.close()
                          }
                        }}
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        View
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleteTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the website and all its content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}