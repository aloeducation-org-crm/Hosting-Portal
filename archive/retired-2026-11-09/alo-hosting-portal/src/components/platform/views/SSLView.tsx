'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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
  Shield, ShieldCheck, ShieldAlert, Plus, Clock, AlertTriangle,
} from 'lucide-react'
import { format, formatDistanceToNow, differenceInDays } from 'date-fns'

interface SslCert {
  id: string
  domain: string
  type: string
  status: string
  issuer: string | null
  issuedAt: string | null
  expiresAt: string | null
  autoRenew: boolean
  createdAt: string
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  expired: { label: 'Expired', className: 'bg-red-500/15 text-red-700 border-red-500/30' },
  pending: { label: 'Pending', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  revoked: { label: 'Revoked', className: 'bg-gray-500/15 text-gray-600 border-gray-500/30' },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-700 border-red-500/30' },
}

const TYPE_CONFIG: Record<string, string> = {
  letsencrypt: "Let's Encrypt",
  custom: 'Custom',
  wildcard: 'Wildcard',
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-10 w-40" />
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}

export default function SSLView() {
  const [certs, setCerts] = useState<SslCert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  const [form, setForm] = useState({ domain: '', type: 'letsencrypt', autoRenew: true })

  const loadCerts = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/ssl', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch')
      setCerts(await res.json())
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
        const res = await fetch('/api/ssl', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        if (!cancelled) {
          setCerts(data)
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

  const handleIssue = async () => {
    const token = getToken()
    if (!token || !form.domain.trim()) return
    try {
      const res = await fetch('/api/ssl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Failed to issue certificate')
      setIssueOpen(false)
      setForm({ domain: '', type: 'letsencrypt', autoRenew: true })
      loadCerts()
    } catch {
      setError('Failed to issue certificate')
    }
  }

  const expiringSoon = (expiresAt: string | null) => {
    if (!expiresAt) return false
    return differenceInDays(new Date(expiresAt), new Date()) < 30
  }

  if (loading) return <div className="p-6"><LoadingSkeleton /></div>

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">SSL Certificates</h2>
          <p className="text-sm text-gray-500 mt-1">Manage SSL/TLS certificates for your domains</p>
        </div>
        <Button onClick={() => setIssueOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
          <Plus className="mr-2 h-4 w-4" /> Issue Certificate
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {/* Expiry Warnings */}
      {certs.filter((c) => c.status === 'active' && expiringSoon(c.expiresAt)).length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">
                {certs.filter((c) => c.status === 'active' && expiringSoon(c.expiresAt)).length} certificate(s) expiring within 30 days
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Certificate Table */}
      <Card className="border-gray-200">
        <CardContent className="p-0">
          {certs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Shield className="h-12 w-12 text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-600">No certificates</h3>
              <p className="text-sm text-gray-400 mt-1">Issue your first SSL certificate to secure your domains</p>
              <Button onClick={() => setIssueOpen(true)} className="mt-4 bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
                <Plus className="mr-2 h-4 w-4" /> Issue Certificate
              </Button>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Issuer</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Auto-Renew</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certs.map((cert) => {
                    const statusConf = (STATUS_CONFIG[cert.status] || STATUS_CONFIG.pending)!
                    const warn = expiringSoon(cert.expiresAt) && cert.status === 'active'
                    return (
                      <TableRow key={cert.id} className={`hover:bg-gray-50 ${warn ? 'bg-amber-50/50' : ''}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {cert.status === 'active' ? (
                              <ShieldCheck className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <ShieldAlert className="h-4 w-4 text-gray-400" />
                            )}
                            <span className="font-medium text-sm">{cert.domain}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {TYPE_CONFIG[cert.type] || cert.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusConf.className}>
                            {statusConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">{cert.issuer || '—'}</TableCell>
                        <TableCell className="text-xs text-gray-400">
                          {cert.issuedAt ? format(new Date(cert.issuedAt), 'MMM d, yyyy') : '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className={warn ? 'text-amber-600 font-medium' : 'text-gray-400'}>
                            {cert.expiresAt ? (
                              <span className="flex items-center gap-1">
                                {warn && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                                {format(new Date(cert.expiresAt), 'MMM d, yyyy')}
                              </span>
                            ) : '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={cert.autoRenew}
                            onCheckedChange={async (checked) => {
                              const token = getToken()
                              if (!token) return
                              try {
                                const res = await fetch(`/api/ssl/${cert.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                  body: JSON.stringify({ autoRenew: checked }),
                                })
                                if (!res.ok) throw new Error('Failed to update auto-renew')
                                setCerts(prev => prev.map(c => c.id === cert.id ? { ...c, autoRenew: checked } : c))
                              } catch {
                                // revert optimistically or show error
                              }
                            }}
                            className="data-[state=checked]:bg-[#E8501A]"
                          />
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

      {/* Issue Dialog */}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Issue SSL Certificate</DialogTitle>
            <DialogDescription>Request a new SSL certificate for your domain.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="ssl-domain">Domain *</Label>
              <Input
                id="ssl-domain"
                value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                placeholder="example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="letsencrypt">Let's Encrypt</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="wildcard">Wildcard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="auto-renew">Auto-Renew</Label>
                <p className="text-xs text-gray-400 mt-0.5">Automatically renew before expiry</p>
              </div>
              <Switch
                id="auto-renew"
                checked={form.autoRenew}
                onCheckedChange={(v) => setForm({ ...form, autoRenew: v })}
                className="data-[state=checked]:bg-[#E8501A]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueOpen(false)}>Cancel</Button>
            <Button onClick={handleIssue} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white" disabled={!form.domain.trim()}>
              Issue Certificate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}