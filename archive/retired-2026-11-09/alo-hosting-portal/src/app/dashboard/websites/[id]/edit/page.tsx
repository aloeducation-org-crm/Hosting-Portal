'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'
import {
  ArrowLeft,
  Save,
  Eye,
  Code2,
  Globe,
  Loader2,
  ExternalLink,
  Power,
  PowerOff,
  Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
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

interface Website {
  id: string
  name: string
  type: string
  status: string
  htmlContent: string | null
  publishedUrl: string | null
  domain: { id: string; name: string; status: string } | null
  lastPublishedAt: string | null
  createdAt: string
  updatedAt: string
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  building: 'bg-amber-100 text-amber-700 border-amber-200',
  suspended: 'bg-red-100 text-red-700 border-red-200',
  archived: 'bg-gray-100 text-gray-600 border-gray-200',
}

export default function WebsiteEditorPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const { token } = useAuthStore()

  const [website, setWebsite] = useState<Website | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Editor state
  const [name, setName] = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const isDirty = website
    ? name !== website.name || htmlContent !== (website.htmlContent || '')
    : false
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [togglingStatus, setTogglingStatus] = useState(false)

  // Publish/unpublish dialog
  const [showToggleDialog, setShowToggleDialog] = useState(false)
  const [pendingStatus, setPendingStatus] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/websites/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (!cancelled && data.success) {
          setWebsite(data.website)
          setName(data.website.name)
          setHtmlContent(data.website.htmlContent || '')
        } else if (!cancelled) {
          setError(data.error || 'Website not found')
        }
      } catch {
        if (!cancelled) setError('Failed to load website')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id, token])



  const handleSave = async () => {
    if (!isDirty) return
    setSaving(true)
    setSaveSuccess(false)
    try {
      const res = await fetch(`/api/websites/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, htmlContent }),
      })
      const data = await res.json()
      if (data.success) {
        setWebsite(data.website)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save website')
    } finally {
      setSaving(false)
    }
  }

  const handleTogglePublish = useCallback(async () => {
    if (!website || !pendingStatus) return
    setTogglingStatus(true)
    try {
      const res = await fetch(`/api/websites/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: pendingStatus,
          publishedUrl: pendingStatus === 'active'
            ? `https://${name.toLowerCase().replace(/\s+/g, '-')}.alolabs.net`
            : null,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setWebsite(data.website)
        setShowToggleDialog(false)
      }
    } catch {
      // Error handled silently
    } finally {
      setTogglingStatus(false)
    }
  }, [id, name, pendingStatus, website, token])

  // Keyboard shortcut: Ctrl+S to save
  const handleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())
  useEffect(() => { handleSaveRef.current = handleSave })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSaveRef.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[600px]">
          <Skeleton className="min-h-[400px]" />
          <Skeleton className="min-h-[400px]" />
        </div>
      </div>
    )
  }

  if (error || !website) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 mb-4">
          <Globe className="h-8 w-8 text-red-400" />
        </div>
        <h3 className="text-lg font-semibold text-[#1E293B] mb-1">
          {error || 'Website not found'}
        </h3>
        <Button
          variant="outline"
          onClick={() => router.push('/dashboard/websites')}
          className="mt-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Websites
        </Button>
      </div>
    )
  }

  const isActive = website.status === 'active'

  return (
    <div className="min-h-screen">
      {/* Back button */}
      <button
        onClick={() => router.push('/dashboard/websites')}
        className="flex items-center gap-2 text-sm text-[#475569] hover:text-[#E8501A] transition-colors mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Websites
      </button>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs h-10 text-sm font-medium"
          />
          <Badge variant="outline" className={STATUS_STYLES[website.status] || STATUS_STYLES.building}>
            {website.status}
          </Badge>
          {isDirty && (
            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-200 bg-amber-50">
              Unsaved changes
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* View live button */}
          {isActive && htmlContent && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const win = window.open('', '_blank')
                if (win) {
                  win.document.write(htmlContent)
                  win.document.close()
                }
              }}
              className="text-sm"
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              View Live
            </Button>
          )}

          {/* Publish/Unpublish toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPendingStatus(isActive ? 'building' : 'active')
              setShowToggleDialog(true)
            }}
            disabled={togglingStatus || (!isActive && !htmlContent.trim())}
            className={cn(
              'text-sm',
              isActive
                ? 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
                : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50',
            )}
          >
            {togglingStatus ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : isActive ? (
              <PowerOff className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Power className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isActive ? 'Unpublish' : 'Publish'}
          </Button>

          {/* Save button */}
          <Button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="bg-[#E8501A] hover:bg-[#C73D12] text-white text-sm"
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : saveSuccess ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Info bar */}
      <div className="flex items-center gap-4 mb-4 text-xs text-[#9CA3AF] px-1">
        <span>Type: <span className="text-[#1E293B] font-medium capitalize">{website.type}</span></span>
        <span>·</span>
        <span>Size: <span className="text-[#1E293B] font-medium">{(htmlContent.length / 1024).toFixed(1)} KB</span></span>
        {website.lastPublishedAt && (
          <>
            <span>·</span>
            <span>Published: <span className="text-[#1E293B] font-medium">
              {new Date(website.lastPublishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span></span>
          </>
        )}
        {website.domain && (
          <>
            <span>·</span>
            <span>Domain: <span className="text-[#1E293B] font-medium">{website.domain.name}</span></span>
          </>
        )}
        <span className="ml-auto text-[#9CA3AF]">Ctrl+S to save</span>
      </div>

      {/* Split view: Code Editor + Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[calc(100vh-240px)]">
        {/* Code Editor */}
        <div className="flex flex-col min-h-[400px] lg:min-h-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 rounded-t-lg">
            <Code2 className="h-4 w-4 text-gray-400" />
            <span className="text-xs font-medium text-gray-400">HTML Editor</span>
            {isDirty && (
              <span className="ml-auto text-[10px] text-amber-400">● Modified</span>
            )}
          </div>
          <Textarea
            value={htmlContent}
            onChange={(e) => setHtmlContent(e.target.value)}
            className="flex-1 min-h-[400px] lg:min-h-0 font-mono text-xs leading-relaxed bg-gray-950 text-gray-300 border-0 rounded-t-none rounded-b-lg resize-none p-4 focus-visible:ring-1 focus-visible:ring-[#E8501A]"
            spellCheck={false}
          />
        </div>

        {/* Live Preview */}
        <div className="flex flex-col min-h-[400px] lg:min-h-0">
          <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-t-lg">
            <Eye className="h-4 w-4 text-[#475569]" />
            <span className="text-xs font-medium text-[#475569]">Live Preview</span>
          </div>
          <div className="flex-1 min-h-[400px] lg:min-h-0 bg-white border border-t-0 border-gray-200 rounded-b-lg overflow-hidden">
            {htmlContent ? (
              <iframe
                srcDoc={htmlContent}
                sandbox="allow-scripts"
                className="w-full h-full border-0"
                title="Website Preview"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Eye className="h-12 w-12 text-gray-200 mb-3" />
                <p className="text-sm text-[#9CA3AF]">Start editing HTML to see a preview</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Publish/Unpublish confirmation */}
      <AlertDialog open={showToggleDialog} onOpenChange={setShowToggleDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingStatus === 'active' ? 'Publish Website' : 'Unpublish Website'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStatus === 'active'
                ? `This will make "${name}" publicly accessible at your domain. The website content will be live immediately.`
                : `This will take "${name}" offline. Visitors will no longer be able to access it.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={togglingStatus}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTogglePublish}
              disabled={togglingStatus}
              className={pendingStatus === 'active' ? 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-600' : 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-600'}
            >
              {togglingStatus ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : pendingStatus === 'active' ? (
                <Power className="mr-2 h-4 w-4" />
              ) : (
                <PowerOff className="mr-2 h-4 w-4" />
              )}
              {pendingStatus === 'active' ? 'Publish Now' : 'Unpublish'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

