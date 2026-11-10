'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
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
  Plus, Trash2, Search, Shield, Key, Flame, AlertCircle, FileText,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'

interface AuditLog {
  id: string
  action: string
  resource: string
  resourceName: string
  ip: string
  date: string
}

interface SshKey {
  id: string
  name: string
  type: string
  fingerprint: string
  createdAt: string
}

interface FirewallRule {
  id: string
  name: string
  protocol: string
  port: string
  source: string
  action: string
  enabled: boolean
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  delete: 'bg-red-500/15 text-red-700 border-red-500/30',
  update: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  login: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  deploy: 'bg-purple-500/15 text-purple-700 border-purple-500/30',
}

const KEY_TYPE_COLORS: Record<string, string> = {
  ED25519: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  RSA: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  ECDSA: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
}

export default function SecurityView() {
  const [activeTab, setActiveTab] = useState('audit')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Audit logs
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditSearch, setAuditSearch] = useState('')
  const [auditFilter, setAuditFilter] = useState('all')

  // SSH Keys
  const [sshKeys, setSshKeys] = useState<SshKey[]>([])
  const [addKeyOpen, setAddKeyOpen] = useState(false)
  const [keyForm, setKeyForm] = useState({ name: '', publicKey: '' })

  // Firewall
  const [firewallRules, setFirewallRules] = useState<FirewallRule[]>([])
  const [addRuleOpen, setAddRuleOpen] = useState(false)
  const [ruleForm, setRuleForm] = useState({ name: '', protocol: 'TCP', port: '', source: '0.0.0.0/0', action: 'allow' })

  const fetchSshKeys = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/security/ssh-keys', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch SSH keys')
      const data = await res.json()
      setSshKeys(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const fetchFirewall = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/security/firewall', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch firewall rules')
      const data = await res.json()
      setFirewallRules(data)
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
        let url: string
        if (activeTab === 'audit') {
          const params = new URLSearchParams()
          if (auditSearch) params.set('search', auditSearch)
          if (auditFilter !== 'all') params.set('action', auditFilter)
          url = `/api/security/audit-logs?${params}`
        } else if (activeTab === 'ssh') {
          url = '/api/security/ssh-keys'
        } else {
          url = '/api/security/firewall'
        }
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        if (!cancelled) {
          if (activeTab === 'audit') setAuditLogs(data)
          else if (activeTab === 'ssh') setSshKeys(data)
          else setFirewallRules(data)
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
  }, [activeTab, auditSearch, auditFilter])

  const handleAddKey = async () => {
    const token = getToken()
    if (!token || !keyForm.name.trim() || !keyForm.publicKey.trim()) return
    try {
      const res = await fetch('/api/security/ssh-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(keyForm),
      })
      if (!res.ok) throw new Error('Failed to add SSH key')
      toast.success('SSH key added successfully')
      setAddKeyOpen(false)
      setKeyForm({ name: '', publicKey: '' })
      fetchSshKeys()
    } catch {
      toast.error('Failed to add SSH key')
    }
  }

  const handleDeleteKey = async (id: string) => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(`/api/security/ssh-keys?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to delete SSH key')
      toast.success('SSH key deleted')
      setSshKeys((prev) => prev.filter((k) => k.id !== id))
    } catch {
      toast.error('Failed to delete SSH key')
    }
  }

  const handleAddRule = async () => {
    const token = getToken()
    if (!token || !ruleForm.name.trim() || !ruleForm.port.trim()) return
    try {
      const res = await fetch('/api/security/firewall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(ruleForm),
      })
      if (!res.ok) throw new Error('Failed to add firewall rule')
      toast.success('Firewall rule added')
      setAddRuleOpen(false)
      setRuleForm({ name: '', protocol: 'TCP', port: '', source: '0.0.0.0/0', action: 'allow' })
      fetchFirewall()
    } catch {
      toast.error('Failed to add firewall rule')
    }
  }

  const toggleRule = async (id: string, enabled: boolean) => {
    const token = getToken()
    if (!token) return
    setFirewallRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled } : r))
    try {
      const res = await fetch(`/api/security/firewall?id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error('Failed to update rule')
    } catch {
      setFirewallRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled: !enabled } : r))
      toast.error('Failed to update rule')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Security</h2>
        <p className="text-sm text-gray-500 mt-1">Manage security settings and access controls</p>
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
          <TabsTrigger value="audit">Audit Logs</TabsTrigger>
          <TabsTrigger value="ssh">SSH Keys</TabsTrigger>
          <TabsTrigger value="firewall">Firewall</TabsTrigger>
        </TabsList>

        {/* Audit Logs Tab */}
        <TabsContent value="audit">
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search logs..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={auditFilter} onValueChange={setAuditFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Filter action" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Actions</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
                <SelectItem value="login">Login</SelectItem>
                <SelectItem value="deploy">Deploy</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : auditLogs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No audit logs found</h3>
                <p className="text-sm text-gray-400 mt-1">Logs will appear as actions are performed</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          <Badge variant="outline" className={ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-600'}>
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-600">{log.resource}</TableCell>
                        <TableCell className="font-medium">{log.resourceName}</TableCell>
                        <TableCell className="font-mono text-sm text-gray-500">{log.ip}</TableCell>
                        <TableCell className="text-gray-400 text-sm">
                          {formatDistanceToNow(new Date(log.date), { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* SSH Keys Tab */}
        <TabsContent value="ssh">
          <div className="flex justify-end mb-6">
            <Button onClick={() => setAddKeyOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
              <Plus className="mr-2 h-4 w-4" /> Add SSH Key
            </Button>
          </div>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
            </div>
          ) : sshKeys.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Key className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No SSH keys</h3>
                <p className="text-sm text-gray-400 mt-1">Add an SSH key for secure server access</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sshKeys.map((key) => (
                <Card key={key.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8501A]/10 text-[#E8501A]">
                          <Key className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{key.name}</CardTitle>
                          <Badge variant="outline" className={`mt-1 text-[10px] ${KEY_TYPE_COLORS[key.type] || ''}`}>
                            {key.type}
                          </Badge>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-gray-400 hover:text-red-600" onClick={() => handleDeleteKey(key.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <p className="text-xs text-gray-400">Fingerprint</p>
                      <code className="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded block truncate">
                        SHA256:{key.fingerprint}
                      </code>
                    </div>
                    <p className="text-xs text-gray-400">
                      Added {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Firewall Tab */}
        <TabsContent value="firewall">
          <div className="flex justify-end mb-6">
            <Button onClick={() => setAddRuleOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
              <Plus className="mr-2 h-4 w-4" /> Add Rule
            </Button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : firewallRules.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Flame className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No firewall rules</h3>
                <p className="text-sm text-gray-400 mt-1">Add rules to control network traffic</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Protocol</TableHead>
                      <TableHead>Port</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Enabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {firewallRules.map((rule) => (
                      <TableRow key={rule.id} className={!rule.enabled ? 'opacity-50' : ''}>
                        <TableCell className="font-medium">{rule.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-200">
                            {rule.protocol}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{rule.port}</TableCell>
                        <TableCell className="font-mono text-sm text-gray-500">{rule.source}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            rule.action === 'allow'
                              ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
                              : 'bg-red-500/15 text-red-700 border-red-500/30'
                          }>
                            {rule.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={(checked) => toggleRule(rule.id, checked)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Add SSH Key Dialog */}
      <Dialog open={addKeyOpen} onOpenChange={setAddKeyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add SSH Key</DialogTitle>
            <DialogDescription>Add a new public SSH key for server access.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="key-name">Name *</Label>
              <Input id="key-name" value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="my-laptop" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="key-public">Public Key *</Label>
              <Textarea
                id="key-public"
                value={keyForm.publicKey}
                onChange={(e) => setKeyForm({ ...keyForm, publicKey: e.target.value })}
                placeholder="ssh-ed25519 AAAA..."
                rows={4}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddKeyOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAddKey}
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              disabled={!keyForm.name.trim() || !keyForm.publicKey.trim()}
            >
              Add Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Firewall Rule Dialog */}
      <Dialog open={addRuleOpen} onOpenChange={setAddRuleOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Firewall Rule</DialogTitle>
            <DialogDescription>Create a new firewall rule to control traffic.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="rule-name">Rule Name *</Label>
              <Input id="rule-name" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="Allow HTTP" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Protocol</Label>
                <Select value={ruleForm.protocol} onValueChange={(v) => setRuleForm({ ...ruleForm, protocol: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TCP">TCP</SelectItem>
                    <SelectItem value="UDP">UDP</SelectItem>
                    <SelectItem value="ICMP">ICMP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rule-port">Port *</Label>
                <Input id="rule-port" value={ruleForm.port} onChange={(e) => setRuleForm({ ...ruleForm, port: e.target.value })} placeholder="80, 443" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-source">Source CIDR</Label>
              <Input id="rule-source" value={ruleForm.source} onChange={(e) => setRuleForm({ ...ruleForm, source: e.target.value })} placeholder="0.0.0.0/0" />
            </div>
            <div className="grid gap-2">
              <Label>Action</Label>
              <Select value={ruleForm.action} onValueChange={(v) => setRuleForm({ ...ruleForm, action: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRuleOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAddRule}
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              disabled={!ruleForm.name.trim() || !ruleForm.port.trim()}
            >
              Add Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}