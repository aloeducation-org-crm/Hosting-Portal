'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Plus, Trash2, Pencil, Globe, Loader, AlertCircle, ArrowUpDown,
} from 'lucide-react'
import { toast } from 'sonner'

interface DnsRecord {
  id: string
  domainId?: string
  type: string
  name: string
  value: string
  ttl: number
  priority?: number | null
  isActive?: boolean
}

interface MineDomain {
  id: string
  domain: string
  website?: { domain?: string } | null
}

interface LoadBalancer {
  id: string
  name: string
  protocol: string
  port: number
  algorithm: string
  targetsCount: number
  status: string
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

const DNS_TYPE_COLORS: Record<string, string> = {
  A: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  AAAA: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  CNAME: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  MX: 'bg-purple-500/15 text-purple-700 border-purple-500/30',
  TXT: 'bg-gray-500/15 text-gray-600 border-gray-500/30',
  NS: 'bg-orange-500/15 text-orange-700 border-orange-500/30',
}

const ALGO_COLORS: Record<string, string> = {
  round_robin: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  least_connections: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  ip_hash: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
}

const LB_STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  inactive: 'bg-gray-500/15 text-gray-600 border-gray-500/30',
  deploying: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
}

export default function NetworkView() {
  const [activeTab, setActiveTab] = useState('dns')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // DNS
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([])
  const [dnsDomains, setDnsDomains] = useState<MineDomain[]>([])
  const [selectedDomainId, setSelectedDomainId] = useState('')
  const [dnsOpen, setDnsOpen] = useState(false)
  const [editingDns, setEditingDns] = useState<DnsRecord | null>(null)
  const [dnsForm, setDnsForm] = useState({ type: 'A', name: '', value: '', ttl: '3600' })
  const [dnsPub, setDnsPub] = useState<{
    mode: string
    state: string
    blocker: string | null
    behavior: string
    lastLivePublishAt?: string | null
  } | null>(null)

  // Load Balancers
  const [loadBalancers, setLoadBalancers] = useState<LoadBalancer[]>([])
  const [lbOpen, setLbOpen] = useState(false)
  const [lbForm, setLbForm] = useState({ name: '', protocol: 'HTTP', port: '443', algorithm: 'round_robin' })

  const fetchDns = async (domainId?: string) => {
    const target = domainId ?? selectedDomainId
    if (!target) {
      setDnsRecords([])
      return
    }
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(`/api/network/dns?domainId=${encodeURIComponent(target)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch DNS records')
      const body = await res.json()
      setDnsRecords(Array.isArray(body) ? body : body?.data ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const fetchLoadBalancers = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/network/load-balancers', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch load balancers')
      const data = await res.json()
      setLoadBalancers(data)
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
        if (activeTab === 'dns') {
          // Domains first: the records API is scoped per domain.
          const dres = await fetch('/api/domains/mine', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!dres.ok) throw new Error('Failed to fetch domains')
          const dbody = await dres.json()
          const mine: MineDomain[] = Array.isArray(dbody) ? dbody : dbody?.data ?? []
          if (cancelled) return
          setDnsDomains(mine)
          const firstId = mine[0]?.id ?? ''
          setSelectedDomainId(firstId)
          if (firstId) {
            const res = await fetch(`/api/network/dns?domainId=${encodeURIComponent(firstId)}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (res.ok) {
              const body = await res.json()
              setDnsRecords(Array.isArray(body) ? body : body?.data ?? [])
            }
          } else {
            setDnsRecords([])
          }
          setError(null)
          // Honest publication state (§8) — advisory banner only; a failure
          // here never blocks the records table.
          try {
            const sres = await fetch('/api/network/dns/status', {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (sres.ok) {
              const sbody = await sres.json()
              if (!cancelled) setDnsPub(sbody?.data ?? null)
            }
          } catch {
            /* non-critical */
          }
        } else {
          const res = await fetch('/api/network/load-balancers', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) throw new Error('Failed to fetch')
          const data = await res.json()
          if (!cancelled) setLoadBalancers(data)
        }
        if (!cancelled) {
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
  }, [activeTab])

  const openDnsCreate = () => {
    setEditingDns(null)
    setDnsForm({ type: 'A', name: '', value: '', ttl: '3600' })
    setDnsOpen(true)
  }

  const openDnsEdit = (record: DnsRecord) => {
    setEditingDns(record)
    setDnsForm({
      type: record.type,
      name: record.name,
      value: record.value,
      ttl: String(record.ttl),
    })
    setDnsOpen(true)
  }

  const handleSaveDns = async () => {
    const token = getToken()
    if (!token || !dnsForm.name.trim() || !dnsForm.value.trim()) return
    if (!editingDns && !selectedDomainId) {
      toast.error('No domain selected — add a domain before creating DNS records')
      return
    }
    try {
      const isEdit = !!editingDns
      const url = isEdit ? `/api/network/dns/${editingDns.id}` : '/api/network/dns'
      const method = isEdit ? 'PUT' : 'POST'
      const body = {
        ...dnsForm,
        ttl: parseInt(dnsForm.ttl) || 3600,
        ...(isEdit ? {} : { domainId: selectedDomainId }),
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        // Surface the API's honest refusal reason (e.g. provider blocked).
        const b = await res.json().catch(() => null)
        throw new Error(
          b?.message ?? b?.error?.message ?? 'Failed to save DNS record',
        )
      }
      toast.success(isEdit ? 'DNS record updated' : 'DNS record created')
      setDnsOpen(false)
      fetchDns()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save DNS record')
    }
  }

  const handleDeleteDns = async (id: string) => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(`/api/network/dns/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.message ?? b?.error ?? 'Failed to delete DNS record')
      }
      toast.success('DNS record deleted')
      setDnsRecords((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete DNS record')
    }
  }

  const handleCreateLb = async () => {
    const token = getToken()
    if (!token || !lbForm.name.trim()) return
    try {
      const res = await fetch('/api/network/load-balancers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...lbForm, port: parseInt(lbForm.port) || 443 }),
      })
      if (!res.ok) throw new Error('Failed to create load balancer')
      toast.success('Load balancer created')
      setLbOpen(false)
      setLbForm({ name: '', protocol: 'HTTP', port: '443', algorithm: 'round_robin' })
      fetchLoadBalancers()
    } catch {
      toast.error('Failed to create load balancer')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Network</h2>
        <p className="text-sm text-gray-500 mt-1">Manage DNS, load balancers, and network configuration</p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="dns">DNS Records</TabsTrigger>
          <TabsTrigger value="loadbalancers">Load Balancers</TabsTrigger>
        </TabsList>

        {/* DNS Records Tab */}
        <TabsContent value="dns">
          {dnsPub && (
            <Card
              className={
                dnsPub.state === 'active'
                  ? 'border-emerald-200 bg-emerald-50 mb-6'
                  : dnsPub.state === 'unverified'
                    ? 'border-blue-200 bg-blue-50 mb-6'
                    : 'border-amber-200 bg-amber-50 mb-6'
              }
            >
              <CardContent className="p-4 text-sm text-gray-800">
                <span className="font-medium">DNS publication — mode “{dnsPub.mode}” ({dnsPub.state}):</span>{' '}
                {dnsPub.blocker ?? dnsPub.behavior}
                {dnsPub.state === 'active' && dnsPub.lastLivePublishAt && (
                  <span className="text-emerald-700"> Last live publish: {dnsPub.lastLivePublishAt}.</span>
                )}
              </CardContent>
            </Card>
          )}
          {dnsDomains.length > 1 && (
            <div className="flex items-center gap-2 mb-4">
              <Label className="text-sm text-gray-500 shrink-0">Domain</Label>
              <Select value={selectedDomainId} onValueChange={(v) => {
                setSelectedDomainId(v)
                fetchDns(v)
              }}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue placeholder="Select a domain" />
                </SelectTrigger>
                <SelectContent>
                  {dnsDomains.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.domain}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end mb-6">
            <Button
              onClick={openDnsCreate}
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              disabled={dnsDomains.length === 0}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Record
            </Button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : dnsRecords.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Globe className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">
                  {dnsDomains.length === 0 ? 'No domains yet' : 'No DNS records'}
                </h3>
                <p className="text-sm text-gray-400 mt-1">
                  {dnsDomains.length === 0
                    ? 'Add a domain to a website first — DNS records are scoped per domain'
                    : 'Add a record to configure your domain'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>TTL</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dnsRecords.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell>
                          <Badge variant="outline" className={DNS_TYPE_COLORS[record.type] || 'bg-gray-100 text-gray-600'}>
                            {record.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm font-medium">{record.name}</TableCell>
                        <TableCell className="font-mono text-sm text-gray-500 max-w-[200px] truncate">{record.value}</TableCell>
                        <TableCell className="text-sm text-gray-500">{record.ttl}s</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            record.isActive === false
                              ? 'bg-gray-100 text-gray-500 border-gray-300'
                              : 'bg-emerald-500/15 text-emerald-700 border-emerald-300'
                          }>
                            {record.isActive === false ? 'Inactive' : 'Active'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-[#E8501A]" onClick={() => openDnsEdit(record)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-red-600" onClick={() => handleDeleteDns(record.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Load Balancers Tab */}
        <TabsContent value="loadbalancers">
          <div className="flex justify-end mb-6">
            <Button onClick={() => setLbOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
              <Plus className="mr-2 h-4 w-4" /> Create Load Balancer
            </Button>
          </div>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
            </div>
          ) : loadBalancers.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Loader className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No load balancers</h3>
                <p className="text-sm text-gray-400 mt-1">Create one to distribute traffic across targets</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {loadBalancers.map((lb) => (
                <Card key={lb.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8501A]/10 text-[#E8501A]">
                          <ArrowUpDown className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{lb.name}</CardTitle>
                          <p className="text-xs text-gray-400 mt-0.5">{lb.protocol} : {lb.port}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className={LB_STATUS_COLORS[lb.status] || ''}>
                        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                          lb.status === 'active' ? 'bg-emerald-500 animate-pulse' :
                          lb.status === 'deploying' ? 'bg-amber-500 animate-pulse' : 'bg-gray-400'
                        }`} />
                        {lb.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Algorithm</span>
                      <Badge variant="outline" className={ALGO_COLORS[lb.algorithm] || ''}>
                        {lb.algorithm.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Targets</span>
                      <span className="text-gray-700 font-medium">{lb.targetsCount}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* DNS Record Dialog */}
      <Dialog open={dnsOpen} onOpenChange={setDnsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingDns ? 'Edit DNS Record' : 'Add DNS Record'}</DialogTitle>
            <DialogDescription>
              {editingDns ? 'Update an existing DNS record.' : 'Create a new DNS record for your domain.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={dnsForm.type} onValueChange={(v) => setDnsForm({ ...dnsForm, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A</SelectItem>
                    <SelectItem value="AAAA">AAAA</SelectItem>
                    <SelectItem value="CNAME">CNAME</SelectItem>
                    <SelectItem value="MX">MX</SelectItem>
                    <SelectItem value="TXT">TXT</SelectItem>
                    <SelectItem value="NS">NS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dns-ttl">TTL</Label>
                <Input id="dns-ttl" type="number" value={dnsForm.ttl} onChange={(e) => setDnsForm({ ...dnsForm, ttl: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dns-name">Name *</Label>
              <Input id="dns-name" value={dnsForm.name} onChange={(e) => setDnsForm({ ...dnsForm, name: e.target.value })} placeholder="example.com" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dns-value">Value *</Label>
              <Input id="dns-value" value={dnsForm.value} onChange={(e) => setDnsForm({ ...dnsForm, value: e.target.value })} placeholder="192.168.1.1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDnsOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveDns}
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              disabled={!dnsForm.name.trim() || !dnsForm.value.trim() || (!editingDns && !selectedDomainId)}
            >
              {editingDns ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load Balancer Dialog */}
      <Dialog open={lbOpen} onOpenChange={setLbOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Load Balancer</DialogTitle>
            <DialogDescription>Set up a new load balancer to distribute traffic.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="lb-name">Name *</Label>
              <Input id="lb-name" value={lbForm.name} onChange={(e) => setLbForm({ ...lbForm, name: e.target.value })} placeholder="my-lb" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Protocol</Label>
                <Select value={lbForm.protocol} onValueChange={(v) => setLbForm({ ...lbForm, protocol: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HTTP">HTTP</SelectItem>
                    <SelectItem value="HTTPS">HTTPS</SelectItem>
                    <SelectItem value="TCP">TCP</SelectItem>
                    <SelectItem value="UDP">UDP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lb-port">Port</Label>
                <Input id="lb-port" type="number" value={lbForm.port} onChange={(e) => setLbForm({ ...lbForm, port: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Algorithm</Label>
              <Select value={lbForm.algorithm} onValueChange={(v) => setLbForm({ ...lbForm, algorithm: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="round_robin">Round Robin</SelectItem>
                  <SelectItem value="least_connections">Least Connections</SelectItem>
                  <SelectItem value="ip_hash">IP Hash</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLbOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateLb}
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              disabled={!lbForm.name.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}