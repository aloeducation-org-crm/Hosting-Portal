'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, AlertCircle, Inbox, Mail, Send, AtSign } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null }

interface EmailAccount {
  id: string
  email: string
  provider: string
  quota: number
  usedQuota: number
  status: string
  createdAt: string
}

interface EmailCampaign {
  id: string
  subject: string
  body: string
  status: string
  recipientList: string
  recipientCount: number
  openCount: number
  clickCount: number
  scheduledAt: string | null
  sentAt: string | null
  createdAt: string
}

function getAuthHeaders() { return { headers: { Authorization: `Bearer ${getToken()}` } } }

export default function EmailView() {
  const [activeTab, setActiveTab] = useState('accounts')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Accounts
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [accountForm, setAccountForm] = useState({
    email: '',
    provider: 'alolabs',
  })

  // Campaigns
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false)
  const [campaignForm, setCampaignForm] = useState({
    subject: '',
    body: '',
    recipients: '',
  })

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/email/accounts', getAuthHeaders())
      if (!res.ok) throw new Error('Failed to fetch accounts')
      const data = await res.json()
      setAccounts(data.accounts || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const fetchCampaigns = async () => {
    try {
      const res = await fetch('/api/email/campaigns', getAuthHeaders())
      if (!res.ok) throw new Error('Failed to fetch campaigns')
      const data = await res.json()
      setCampaigns(data.campaigns || [])
    } catch (err) {
      setCampaigns([])
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (activeTab === 'accounts') {
          const res = await fetch('/api/email/accounts', getAuthHeaders())
          if (!res.ok) throw new Error('Failed to fetch accounts')
          const data = await res.json()
          if (!cancelled) {
            setAccounts(data.accounts || [])
            setError(null)
            setLoading(false)
          }
        } else {
          const res = await fetch('/api/email/campaigns', getAuthHeaders())
          if (!res.ok) throw new Error('Failed to fetch campaigns')
          const data = await res.json()
          if (!cancelled) {
            setCampaigns(data.campaigns || [])
            setError(null)
            setLoading(false)
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeTab])

  const handleCreateAccount = async () => {
    if (!accountForm.email.trim()) return
    try {
      const res = await fetch('/api/email/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          email: accountForm.email,
          provider: accountForm.provider,
        }),
      })
      if (!res.ok) throw new Error('Failed to create account')
      toast.success('Email account created')
      setAccountDialogOpen(false)
      setAccountForm({ email: '', provider: 'alolabs' })
      await fetchAccounts()
    } catch {
      toast.error('Failed to create email account')
    }
  }

  const handleCreateCampaign = async () => {
    if (!campaignForm.subject.trim() || !campaignForm.body.trim()) return
    const recipientLines = campaignForm.recipients
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    try {
      const res = await fetch('/api/email/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          subject: campaignForm.subject,
          body: campaignForm.body,
          recipientList: JSON.stringify(recipientLines),
          recipientCount: recipientLines.length,
        }),
      })
      if (!res.ok) throw new Error('Failed to create campaign')
      toast.success('Campaign created')
      setCampaignDialogOpen(false)
      setCampaignForm({ subject: '', body: '', recipients: '' })
      await fetchCampaigns()
    } catch {
      toast.error('Failed to create campaign')
    }
  }

  const providerColor = (provider: string) => {
    switch (provider) {
      case 'alolabs': return 'bg-[#E8501A]/10 text-[#E8501A]'
      case 'google': return 'bg-red-50 text-red-600'
      case 'custom': return 'bg-gray-100 text-gray-600'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  const campaignStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-600'
      case 'scheduled': return 'bg-purple-100 text-purple-700'
      case 'sent': return 'bg-green-100 text-green-700'
      case 'failed': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  return (
    <div className="p-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="accounts" className="gap-1.5"><AtSign className="h-3.5 w-3.5" /> Accounts</TabsTrigger>
          <TabsTrigger value="campaigns" className="gap-1.5"><Send className="h-3.5 w-3.5" /> Campaigns</TabsTrigger>
        </TabsList>

        {/* Accounts Tab */}
        <TabsContent value="accounts">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setAccountDialogOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Account
            </Button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
                <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchAccounts().finally(() => setLoading(false)) }} className="ml-auto">Retry</Button>
              </CardContent>
            </Card>
          ) : accounts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Mail className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No email accounts</h3>
                <p className="text-sm text-gray-400 mt-1">Add your first email account to get started</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {accounts.map((account) => {
                const usagePercent = account.quota > 0 ? Math.round((account.usedQuota / account.quota) * 100) : 0
                return (
                  <Card key={account.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8501A]/10">
                            <Mail className="h-5 w-5 text-[#E8501A]" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{account.email}</p>
                            <p className="text-xs text-gray-400">
                              Created {format(new Date(account.createdAt), 'MMM d, yyyy')}
                            </p>
                          </div>
                        </div>
                        <Badge variant="secondary" className={providerColor(account.provider)}>
                          {account.provider}
                        </Badge>
                      </div>

                      {/* Quota Bar */}
                      <div className="space-y-1.5 mb-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">Storage</span>
                          <span className="text-gray-600 font-medium">
                            {account.usedQuota} / {account.quota} MB
                          </span>
                        </div>
                        <Progress value={usagePercent} className="h-2" />
                      </div>

                      <div className="flex items-center justify-between">
                        <Badge
                          variant="secondary"
                          className={
                            account.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }
                        >
                          {account.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setCampaignDialogOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              <Plus className="h-4 w-4 mr-1.5" />
              Create Campaign
            </Button>
          </div>

          {loading ? (
            <Card>
              <CardContent className="p-0">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-14 border-b" />
                ))}
              </CardContent>
            </Card>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
              </CardContent>
            </Card>
          ) : campaigns.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Send className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No campaigns</h3>
                <p className="text-sm text-gray-400 mt-1">Create your first email campaign to get started</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subject</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Recipients</TableHead>
                        <TableHead>Open Rate</TableHead>
                        <TableHead>Click Rate</TableHead>
                        <TableHead>Sent Date</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {campaigns.map((campaign) => {
                        const openRate = campaign.recipientCount > 0 ? ((campaign.openCount / campaign.recipientCount) * 100).toFixed(1) : '0.0'
                        const clickRate = campaign.recipientCount > 0 ? ((campaign.clickCount / campaign.recipientCount) * 100).toFixed(1) : '0.0'
                        return (
                          <TableRow key={campaign.id}>
                            <TableCell className="font-medium">{campaign.subject}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className={campaignStatusColor(campaign.status)}>
                                {campaign.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-gray-500 text-sm">{campaign.recipientCount}</TableCell>
                            <TableCell className="text-gray-500 text-sm">{openRate}%</TableCell>
                            <TableCell className="text-gray-500 text-sm">{clickRate}%</TableCell>
                            <TableCell className="text-gray-400 text-sm">
                              {campaign.sentAt ? format(new Date(campaign.sentAt), 'MMM d, yyyy') : '-'}
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm">View</Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Account Dialog */}
      <Dialog open={accountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Email Account</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Email Address / Prefix</Label>
              <Input
                value={accountForm.email}
                onChange={(e) => setAccountForm(f => ({ ...f, email: e.target.value }))}
                placeholder="you (will become you@alolabs.net)"
              />
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={accountForm.provider} onValueChange={(v) => setAccountForm(f => ({ ...f, provider: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="alolabs">ALO Labs</SelectItem>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccountDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateAccount} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              Create Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Campaign Dialog */}
      <Dialog open={campaignDialogOpen} onOpenChange={setCampaignDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input
                value={campaignForm.subject}
                onChange={(e) => setCampaignForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="Welcome to our newsletter"
              />
            </div>
            <div className="space-y-2">
              <Label>Body *</Label>
              <Textarea
                value={campaignForm.body}
                onChange={(e) => setCampaignForm(f => ({ ...f, body: e.target.value }))}
                placeholder="Write your email content here..."
                rows={6}
              />
            </div>
            <div className="space-y-2">
              <Label>Recipients (one email per line)</Label>
              <Textarea
                value={campaignForm.recipients}
                onChange={(e) => setCampaignForm(f => ({ ...f, recipients: e.target.value }))}
                placeholder={"user1@example.com\nuser2@example.com\nuser3@example.com"}
                rows={4}
              />
              <p className="text-xs text-gray-400">
                {campaignForm.recipients.split('\n').filter(l => l.trim()).length} recipient(s)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampaignDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateCampaign} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}