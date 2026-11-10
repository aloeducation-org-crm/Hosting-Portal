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
import { Progress } from '@/components/ui/progress'
import {
  Plus, Trash2, HardDrive, AlertCircle, FolderOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'

interface Bucket {
  id: string
  name: string
  region: string
  access: string
  size: number
  objectCount: number
  createdAt: string
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

const REGION_COLORS: Record<string, string> = {
  'us-east-1': 'bg-purple-500/15 text-purple-700 border-purple-500/30',
  'eu-west-1': 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  'ap-southeast-1': 'bg-amber-500/15 text-amber-700 border-amber-500/30',
}

const ACCESS_COLORS: Record<string, string> = {
  private: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  public: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  readonly: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function StorageView() {
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', region: 'us-east-1', access: 'private' })
  const [totalUsed, setTotalUsed] = useState(0)
  const [totalQuota] = useState(107374182400) // 100 GB

  const loadBuckets = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/storage/buckets', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch buckets')
      const data = await res.json()
      setBuckets(data)
      setTotalUsed(data.reduce((sum: number, b: Bucket) => sum + b.size, 0))
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
        const res = await fetch('/api/storage/buckets', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch buckets')
        const data = await res.json()
        if (!cancelled) {
          setBuckets(data)
          setTotalUsed(data.reduce((sum: number, b: Bucket) => sum + b.size, 0))
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
      const res = await fetch('/api/storage/buckets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Failed to create bucket')
      toast.success('Bucket created successfully')
      setCreateOpen(false)
      setForm({ name: '', region: 'us-east-1', access: 'private' })
      loadBuckets()
    } catch {
      toast.error('Failed to create bucket')
    }
  }

  const handleDelete = async (id: string) => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(`/api/storage/buckets?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to delete bucket')
      toast.success('Bucket deleted')
      setBuckets((prev) => prev.filter((b) => b.id !== id))
    } catch {
      toast.error('Failed to delete bucket')
    }
  }

  const usagePct = Math.min(100, Math.round((totalUsed / totalQuota) * 100))

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Storage</h2>
          <p className="text-sm text-gray-500 mt-1">S3-compatible object storage</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
          <Plus className="mr-2 h-4 w-4" /> Create Bucket
        </Button>
      </div>

      {/* Total Storage Usage */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm">
              <HardDrive className="h-4 w-4 text-gray-500" />
              <span className="text-gray-600 font-medium">Total Storage Usage</span>
            </div>
            <span className="text-sm text-gray-500">
              {formatBytes(totalUsed)} / {formatBytes(totalQuota)} ({usagePct}%)
            </span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${usagePct > 80 ? 'bg-red-500' : usagePct > 60 ? 'bg-amber-500' : 'bg-[#E8501A]'}`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
            <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); loadBuckets() }} className="ml-auto">Retry</Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-8 w-full" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
          </div>
        </div>
      ) : buckets.length === 0 && !error ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <HardDrive className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-600">No buckets yet</h3>
            <p className="text-sm text-gray-400 mt-1">Create your first bucket to store objects</p>
            <Button onClick={() => setCreateOpen(true)} className="mt-4 bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
              <Plus className="mr-2 h-4 w-4" /> Create Bucket
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {buckets.map((bucket) => (
            <Card key={bucket.id} className="group hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8501A]/10 text-[#E8501A]">
                      <FolderOpen className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-semibold">{bucket.name}</CardTitle>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatDistanceToNow(new Date(bucket.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-red-600" onClick={() => handleDelete(bucket.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={REGION_COLORS[bucket.region] || ''}>
                    {bucket.region}
                  </Badge>
                  <Badge variant="outline" className={ACCESS_COLORS[bucket.access] || ''}>
                    {bucket.access}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-400">Size</p>
                    <p className="text-sm font-semibold text-gray-700">{formatBytes(bucket.size)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Objects</p>
                    <p className="text-sm font-semibold text-gray-700">{bucket.objectCount.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Bucket</DialogTitle>
            <DialogDescription>Create a new S3-compatible storage bucket.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="bucket-name">Bucket Name *</Label>
              <Input id="bucket-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-bucket" />
            </div>
            <div className="grid gap-2">
              <Label>Region</Label>
              <Select value={form.region} onValueChange={(v) => setForm({ ...form, region: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
                  <SelectItem value="eu-west-1">EU West (Ireland)</SelectItem>
                  <SelectItem value="ap-southeast-1">AP Southeast (Singapore)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Access Level</Label>
              <Select value={form.access} onValueChange={(v) => setForm({ ...form, access: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="readonly">Read-Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              disabled={!form.name.trim()}
            >
              Create Bucket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}