'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Globe,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Calendar,
  Shield,
  RefreshCw,
  Server,
  FileText,
  Plus,
  Pencil,
  Trash2,
  Lock,
  Unlock,
  ArrowRightLeft,
  AlertTriangle,
  Network,
  Info,
  ExternalLink,
  Save,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

interface DnsRecord {
  id: string
  type: string
  host: string
  value: string
  ttl: number
}

interface DomainData {
  id: string
  name: string
  tld: string
  status: string
  purchaseDate: string
  expiryDate: string | null
  autoRenew: boolean
  locked: boolean
  nameservers: string[]
  dnsRecords: DnsRecord[]
  websites: { id: string; name: string; status: string }[]
}

const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT']
const DEFAULT_TTL = 3600

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  expired: 'bg-red-50 text-red-700 border-red-200',
  transferred: 'bg-blue-50 text-blue-700 border-blue-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
}

export default function DomainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const token = useAuthStore((s) => s.token)
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') || 'overview'

  const [domain, setDomain] = useState<DomainData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(initialTab)

  // Nameserver editing
  const [nameservers, setNameservers] = useState<string[]>([])
  const [newNs, setNewNs] = useState('')
  const [savingNs, setSavingNs] = useState(false)

  // DNS record dialog
  const [dnsDialogOpen, setDnsDialogOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<DnsRecord | null>(null)
  const [recordForm, setRecordForm] = useState<Omit<DnsRecord, 'id'>>({
    type: 'A',
    host: '@',
    value: '',
    ttl: 3600,
  })
  const [savingRecord, setSavingRecord] = useState(false)

  // Delete record confirmation
  const [deleteRecordId, setDeleteRecordId] = useState<string | null>(null)
  const [deletingRecord, setDeletingRecord] = useState(false)

  // Settings states
  const [autoRenew, setAutoRenew] = useState(false)
  const [locked, setLocked] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)

  // Transfer dialog
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)

  // Delete domain dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingDomain, setDeletingDomain] = useState(false)

  const refreshDomain = async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/domains/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setDomain(data.domain)
        setNameservers(data.domain.nameservers)
        setAutoRenew(data.domain.autoRenew)
        setLocked(data.domain.locked)
      }
    } catch {
      // Non-critical on refresh
    }
  }

  const refreshDomainRef = useRef(refreshDomain)
  useEffect(() => { refreshDomainRef.current = refreshDomain })

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/domains/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) {
            setDomain(data.domain)
            setNameservers(data.domain.nameservers)
            setAutoRenew(data.domain.autoRenew)
            setLocked(data.domain.locked)
          }
        } else if (!cancelled) {
          toast.error('Domain not found')
          router.push('/dashboard/domains')
        }
      } catch {
        if (!cancelled) toast.error('Failed to load domain')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token, id, router])

  // Nameserver handlers
  const handleAddNs = () => {
    const trimmed = newNs.trim()
    if (trimmed && !nameservers.includes(trimmed)) {
      setNameservers([...nameservers, trimmed])
      setNewNs('')
    }
  }

  const handleRemoveNs = (index: number) => {
    setNameservers(nameservers.filter((_, i) => i !== index))
  }

  const handleSaveNs = useCallback(async () => {
    if (!token) return
    setSavingNs(true)
    try {
      const res = await fetch(`/api/domains/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nameservers }),
      })
      if (res.ok) {
        toast.success('Nameservers updated')
        refreshDomainRef.current()
      } else {
        toast.error('Failed to update nameservers')
      }
    } catch {
      toast.error('Failed to update nameservers')
    } finally {
      setSavingNs(false)
    }
  }, [token, id, nameservers])

  // DNS record handlers
  const openAddRecordDialog = () => {
    setEditingRecord(null)
    setRecordForm({ type: 'A', host: '@', value: '', ttl: 3600 })
    setDnsDialogOpen(true)
  }

  const openEditRecordDialog = (record: DnsRecord) => {
    setEditingRecord(record)
    setRecordForm({
      type: record.type,
      host: record.host,
      value: record.value,
      ttl: record.ttl,
    })
    setDnsDialogOpen(true)
  }

  const handleSaveRecord = useCallback(async () => {
    if (!token || !domain) return
    if (!recordForm.value.trim()) {
      toast.error('Record value is required')
      return
    }

    setSavingRecord(true)
    try {
      let updatedRecords: DnsRecord[]
      if (editingRecord) {
        updatedRecords = domain.dnsRecords.map((r) =>
          r.id === editingRecord.id
            ? { ...r, ...recordForm, value: recordForm.value.trim() }
            : r
        )
      } else {
        const newRecord: DnsRecord = {
          ...recordForm,
          value: recordForm.value.trim(),
          id: Date.now().toString(),
        }
        updatedRecords = [...domain.dnsRecords, newRecord]
      }

      const res = await fetch(`/api/domains/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dnsRecords: updatedRecords }),
      })

      if (res.ok) {
        toast.success(editingRecord ? 'Record updated' : 'Record added')
        setDnsDialogOpen(false)
        refreshDomain()
      } else {
        toast.error('Failed to save record')
      }
    } catch {
      toast.error('Failed to save record')
    } finally {
      setSavingRecord(false)
    }
  }, [token, id, domain, editingRecord, recordForm, refreshDomain])

  const handleDeleteRecord = useCallback(async () => {
    if (!token || !domain || !deleteRecordId) return
    setDeletingRecord(true)
    try {
      const updatedRecords = domain.dnsRecords.filter((r) => r.id !== deleteRecordId)
      const res = await fetch(`/api/domains/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dnsRecords: updatedRecords }),
      })

      if (res.ok) {
        toast.success('Record deleted')
        setDeleteRecordId(null)
        refreshDomain()
      } else {
        toast.error('Failed to delete record')
      }
    } catch {
      toast.error('Failed to delete record')
    } finally {
      setDeletingRecord(false)
    }
  }, [token, id, domain, deleteRecordId, refreshDomain])

  // Settings handlers
  const handleSaveAutoRenew = useCallback(async () => {
    if (!token) return
    setSavingSettings(true)
    try {
      const res = await fetch(`/api/domains/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ autoRenew }),
      })
      if (res.ok) {
        toast.success(`Auto-renew ${autoRenew ? 'enabled' : 'disabled'}`)
        refreshDomain()
      } else {
        toast.error('Failed to update setting')
      }
    } catch {
      toast.error('Failed to update setting')
    } finally {
      setSavingSettings(false)
    }
  }, [token, id, autoRenew, refreshDomain])

  const handleSaveLocked = useCallback(async () => {
    if (!token) return
    setSavingSettings(true)
    try {
      const res = await fetch(`/api/domains/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ locked }),
      })
      if (res.ok) {
        toast.success(`Domain ${locked ? 'locked' : 'unlocked'}`)
        refreshDomain()
      } else {
        toast.error('Failed to update lock')
      }
    } catch {
      toast.error('Failed to update lock')
    } finally {
      setSavingSettings(false)
    }
  }, [token, id, locked, refreshDomain])

  const handleTransfer = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/domains/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'transferred' }),
      })
      if (res.ok) {
        toast.success('Domain transfer initiated')
        setTransferDialogOpen(false)
        refreshDomain()
      }
    } catch {
      toast.error('Failed to initiate transfer')
    }
  }, [token, id, refreshDomain])

  const handleDeleteDomain = useCallback(async () => {
    if (!token) return
    setDeletingDomain(true)
    try {
      const res = await fetch(`/api/domains/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        toast.success('Domain deleted')
        router.push('/dashboard/domains')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete domain')
      }
    } catch {
      toast.error('Failed to delete domain')
    } finally {
      setDeletingDomain(false)
    }
  }, [token, id, router])

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (!domain) return null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/dashboard/domains')}
          className="text-[#475569] hover:bg-[#FFF7ED] hover:text-[#E8501A]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-[#1E293B] truncate">{domain.name}</h1>
            <Badge variant="outline" className={STATUS_STYLES[domain.status] || ''}>
              {domain.status.charAt(0).toUpperCase() + domain.status.slice(1)}
            </Badge>
            {domain.locked && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                <Lock className="h-3 w-3 mr-1" />
                Locked
              </Badge>
            )}
          </div>
          <p className="text-[#475569] mt-1">
            Manage your domain settings, DNS records, and more
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview" className="gap-1.5">
            <Info className="size-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="dns" className="gap-1.5">
            <Network className="size-4" />
            DNS
            <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
              {domain.dnsRecords.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Shield className="size-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {/* ==================== OVERVIEW TAB ==================== */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {/* Domain Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="border-[#E2E8F0]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[#475569] mb-1">
                  <Globe className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Domain Name</span>
                </div>
                <p className="text-lg font-semibold text-[#1E293B]">{domain.name}</p>
              </CardContent>
            </Card>
            <Card className="border-[#E2E8F0]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[#475569] mb-1">
                  <FileText className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">TLD</span>
                </div>
                <p className="text-lg font-semibold text-[#1E293B]">{domain.tld}</p>
              </CardContent>
            </Card>
            <Card className="border-[#E2E8F0]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[#475569] mb-1">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Status</span>
                </div>
                <Badge variant="outline" className={STATUS_STYLES[domain.status] || ''}>
                  {domain.status.charAt(0).toUpperCase() + domain.status.slice(1)}
                </Badge>
              </CardContent>
            </Card>
            <Card className="border-[#E2E8F0]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[#475569] mb-1">
                  <Calendar className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Purchase Date</span>
                </div>
                <p className="text-sm font-medium text-[#1E293B]">{formatDate(domain.purchaseDate)}</p>
              </CardContent>
            </Card>
            <Card className="border-[#E2E8F0]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[#475569] mb-1">
                  <Calendar className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Expiry Date</span>
                </div>
                <p className="text-sm font-medium text-[#1E293B]">{formatDate(domain.expiryDate)}</p>
              </CardContent>
            </Card>
            <Card className="border-[#E2E8F0]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[#475569] mb-1">
                  <RefreshCw className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Auto-Renew</span>
                </div>
                <p className="text-sm font-medium text-[#1E293B]">
                  {domain.autoRenew ? 'Enabled' : 'Disabled'}
                </p>
              </CardContent>
            </Card>
            <Card className="border-[#E2E8F0]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[#475569] mb-1">
                  <Shield className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Lock Status</span>
                </div>
                <p className="text-sm font-medium text-[#1E293B] flex items-center gap-1.5">
                  {domain.locked ? (
                    <>
                      <Lock className="h-4 w-4 text-amber-500" />
                      Locked
                    </>
                  ) : (
                    <>
                      <Unlock className="h-4 w-4 text-emerald-500" />
                      Unlocked
                    </>
                  )}
                </p>
              </CardContent>
            </Card>
            <Card className="border-[#E2E8F0]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[#475569] mb-1">
                  <Server className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">Nameservers</span>
                </div>
                <p className="text-sm font-medium text-[#1E293B]">
                  {domain.nameservers.length} configured
                </p>
              </CardContent>
            </Card>
            <Card className="border-[#E2E8F0]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-[#475569] mb-1">
                  <Network className="h-4 w-4" />
                  <span className="text-xs font-medium uppercase tracking-wider">DNS Records</span>
                </div>
                <p className="text-sm font-medium text-[#1E293B]">
                  {domain.dnsRecords.length} record{domain.dnsRecords.length !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Linked Websites */}
          {domain.websites.length > 0 && (
            <Card className="border-[#E2E8F0]">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-[#1E293B] flex items-center gap-2">
                  <ExternalLink className="h-4 w-4 text-[#E8501A]" />
                  Linked Websites
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {domain.websites.map((site) => (
                    <div
                      key={site.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-[#E2E8F0] bg-[#F9F8FC]"
                    >
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-[#E8501A]" />
                        <span className="text-sm font-medium text-[#1E293B]">{site.name}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          site.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                        }
                      >
                        {site.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ==================== DNS TAB ==================== */}
        <TabsContent value="dns" className="mt-4 space-y-6">
          {/* Nameservers */}
          <Card className="border-[#E2E8F0]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-[#1E293B] flex items-center gap-2">
                <Server className="h-4 w-4 text-[#E8501A]" />
                Nameservers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {nameservers.map((ns, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 p-2 rounded-lg border border-[#E2E8F0] bg-[#F9F8FC]">
                    <span className="text-xs text-[#475569] w-6 shrink-0">{index + 1}.</span>
                    <Input
                      value={ns}
                      onChange={(e) => {
                        const updated = [...nameservers]
                        updated[index] = e.target.value
                        setNameservers(updated)
                      }}
                      className="h-8 bg-transparent border-none focus-visible:ring-0 p-0 text-sm text-[#1E293B]"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveNs(index)}
                    className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <div className="flex gap-2">
                <Input
                  placeholder="Add nameserver (e.g., ns3.example.com)"
                  value={newNs}
                  onChange={(e) => setNewNs(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddNs()}
                  className="flex-1 bg-[#F9F8FC] border-[#E2E8F0] focus-visible:ring-[#E8501A]/20 h-9 text-sm"
                />
                <Button
                  variant="outline"
                  onClick={handleAddNs}
                  disabled={!newNs.trim()}
                  className="border-[#E2E8F0] text-[#E8501A] hover:bg-[#FFF7ED] h-9"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>

              <Button
                onClick={handleSaveNs}
                disabled={savingNs}
                className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
              >
                {savingNs ? (
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save Nameservers
              </Button>
            </CardContent>
          </Card>

          {/* DNS Records */}
          <Card className="border-[#E2E8F0]">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold text-[#1E293B] flex items-center gap-2">
                  <Network className="h-4 w-4 text-[#E8501A]" />
                  DNS Records
                </CardTitle>
                <Button
                  size="sm"
                  onClick={openAddRecordDialog}
                  className="bg-[#E8501A] hover:bg-[#C73D12] text-white h-8"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Record
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {domain.dnsRecords.length === 0 ? (
                <div className="text-center py-8">
                  <Network className="h-10 w-10 text-[#475569] mx-auto mb-3 opacity-40" />
                  <p className="text-sm text-[#475569]">No DNS records configured yet.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openAddRecordDialog}
                    className="mt-3 border-[#E2E8F0] text-[#E8501A] hover:bg-[#FFF7ED]"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add your first record
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-[#E2E8F0] hover:bg-transparent">
                        <TableHead className="text-[#475569] font-medium">Type</TableHead>
                        <TableHead className="text-[#475569] font-medium">Host</TableHead>
                        <TableHead className="text-[#475569] font-medium">Value</TableHead>
                        <TableHead className="text-[#475569] font-medium hidden sm:table-cell">TTL</TableHead>
                        <TableHead className="text-[#475569] font-medium text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {domain.dnsRecords.map((record) => (
                        <TableRow key={record.id} className="border-[#E2E8F0] hover:bg-[#F9F8FC]">
                          <TableCell>
                            <Badge variant="secondary" className="bg-[#FFF7ED] text-[#E8501A] font-mono text-xs">
                              {record.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-[#1E293B]">{record.host}</TableCell>
                          <TableCell className="font-mono text-sm text-[#1E293B] max-w-48 truncate">
                            {record.value}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-sm text-[#475569]">
                            {record.ttl}s
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditRecordDialog(record)}
                                className="text-[#E8501A] hover:bg-[#FFF7ED] h-7 px-2"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteRecordId(record.id)}
                                className="text-red-400 hover:text-red-600 hover:bg-red-50 h-7 px-2"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== SETTINGS TAB ==================== */}
        <TabsContent value="settings" className="mt-4 space-y-6">
          {/* Auto-Renew */}
          <Card className="border-[#E2E8F0]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF7ED] shrink-0">
                    <RefreshCw className="h-5 w-5 text-[#E8501A]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#1E293B]">Auto-Renew</h3>
                    <p className="text-sm text-[#475569] mt-0.5">
                      Automatically renew your domain before it expires to avoid downtime.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={autoRenew}
                    onCheckedChange={setAutoRenew}
                    disabled={savingSettings}
                    className="data-[state=checked]:bg-[#E8501A]"
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveAutoRenew}
                    disabled={savingSettings}
                    className="bg-[#E8501A] hover:bg-[#C73D12] text-white h-8"
                  >
                    {savingSettings ? (
                      <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Lock Domain */}
          <Card className="border-[#E2E8F0]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 shrink-0">
                    {locked ? (
                      <Lock className="h-5 w-5 text-amber-600" />
                    ) : (
                      <Unlock className="h-5 w-5 text-emerald-600" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#1E293B]">Domain Lock</h3>
                    <p className="text-sm text-[#475569] mt-0.5">
                      Lock your domain to prevent unauthorized transfers. Recommended for security.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={locked}
                    onCheckedChange={setLocked}
                    disabled={savingSettings}
                    className="data-[state=checked]:bg-amber-500"
                  />
                  <Button
                    size="sm"
                    onClick={handleSaveLocked}
                    disabled={savingSettings}
                    className="bg-[#E8501A] hover:bg-[#C73D12] text-white h-8"
                  >
                    {savingSettings ? (
                      <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Transfer Domain */}
          <Card className="border-[#E2E8F0]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 shrink-0">
                    <ArrowRightLeft className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#1E293B]">Transfer Domain</h3>
                    <p className="text-sm text-[#475569] mt-0.5">
                      Transfer this domain to another registrar. Make sure to unlock it first.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setTransferDialogOpen(true)}
                  disabled={domain.locked}
                  className="border-[#E2E8F0] text-[#E8501A] hover:bg-[#FFF7ED]"
                >
                  <ArrowRightLeft className="h-4 w-4 mr-1" />
                  Transfer
                </Button>
              </div>
              {domain.locked && (
                <p className="text-xs text-amber-600 mt-2 ml-13 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Unlock the domain before initiating a transfer.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-red-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-red-600 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Danger Zone
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-[#1E293B]">Delete Domain</h3>
                  <p className="text-sm text-[#475569] mt-0.5">
                    Permanently remove this domain from your account. This action cannot be undone.
                    {domain.websites.length > 0 && (
                      <span className="text-red-500 font-medium">
                        {' '}
                        This domain is linked to {domain.websites.length} website(s) and cannot be deleted
                        until they are removed.
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={domain.websites.some((w) => w.status === 'active' || w.status === 'building')}
                  className="shrink-0"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ==================== DNS RECORD DIALOG ==================== */}
      <Dialog open={dnsDialogOpen} onOpenChange={setDnsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRecord ? 'Edit DNS Record' : 'Add DNS Record'}</DialogTitle>
            <DialogDescription>
              {editingRecord
                ? 'Update the DNS record details below.'
                : 'Add a new DNS record for your domain.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#1E293B]">Record Type</Label>
              <Select
                value={recordForm.type}
                onValueChange={(val) => setRecordForm({ ...recordForm, type: val })}
              >
                <SelectTrigger className="bg-[#F9F8FC] border-[#E2E8F0]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DNS_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#1E293B]">Host</Label>
              <Input
                value={recordForm.host}
                onChange={(e) => setRecordForm({ ...recordForm, host: e.target.value })}
                placeholder="@ or subdomain"
                className="bg-[#F9F8FC] border-[#E2E8F0] focus-visible:ring-[#E8501A]/20"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#1E293B]">
                Value {recordForm.type === 'MX' && '(format: priority server)'}
              </Label>
              <Input
                value={recordForm.value}
                onChange={(e) => setRecordForm({ ...recordForm, value: e.target.value })}
                placeholder={
                  recordForm.type === 'A'
                    ? '192.168.1.1'
                    : recordForm.type === 'CNAME'
                      ? 'example.com'
                      : recordForm.type === 'MX'
                        ? '10 mail.example.com'
                        : 'v=spf1 include:...'
                }
                className="bg-[#F9F8FC] border-[#E2E8F0] focus-visible:ring-[#E8501A]/20"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#1E293B]">TTL (seconds)</Label>
              <Select
                value={String(recordForm.ttl)}
                onValueChange={(val) => setRecordForm({ ...recordForm, ttl: parseInt(val, 10) })}
              >
                <SelectTrigger className="bg-[#F9F8FC] border-[#E2E8F0]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="300">300 (5 minutes)</SelectItem>
                  <SelectItem value="900">900 (15 minutes)</SelectItem>
                  <SelectItem value="1800">1800 (30 minutes)</SelectItem>
                  <SelectItem value="3600">3600 (1 hour)</SelectItem>
                  <SelectItem value="14400">14400 (4 hours)</SelectItem>
                  <SelectItem value="86400">86400 (1 day)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDnsDialogOpen(false)}
              className="border-[#E2E8F0] text-[#475569]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveRecord}
              disabled={savingRecord || !recordForm.value.trim()}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
            >
              {savingRecord ? (
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              {editingRecord ? 'Update Record' : 'Add Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== DELETE RECORD CONFIRMATION ==================== */}
      <AlertDialog open={!!deleteRecordId} onOpenChange={() => setDeleteRecordId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete DNS Record</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this DNS record? This may affect your domain&apos;s
              functionality.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRecord}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRecord}
              disabled={deletingRecord}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deletingRecord ? (
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ==================== TRANSFER DIALOG ==================== */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-[#E8501A]" />
              Transfer Domain
            </DialogTitle>
            <DialogDescription>
              Important information about transferring your domain.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="p-3 rounded-lg bg-[#FFF7ED] border border-[#E2E8F0]">
              <h4 className="font-medium text-[#1E293B] text-sm mb-1">Transfer Process</h4>
              <ul className="text-xs text-[#475569] space-y-1 list-disc list-inside">
                <li>Domain must be unlocked before transfer</li>
                <li>Obtain the authorization code from your current registrar</li>
                <li>Transfer typically takes 5-7 days to complete</li>
                <li>Your domain will remain active during the transfer</li>
              </ul>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-700 flex items-start gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Before initiating a transfer, ensure you have access to the admin email address
                  associated with this domain.
                </span>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransferDialogOpen(false)}
              className="border-[#E2E8F0] text-[#475569]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleTransfer}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
            >
              <ArrowRightLeft className="h-4 w-4 mr-1" />
              Initiate Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== DELETE DOMAIN DIALOG ==================== */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Delete Domain
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{domain.name}</strong> from your account. This
              action cannot be undone. All DNS records and nameserver configurations will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingDomain}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDomain}
              disabled={deletingDomain}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deletingDomain ? (
                <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <span className="flex items-center gap-1">
                  <Trash2 className="h-4 w-4" />
                  Delete Domain
                </span>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

