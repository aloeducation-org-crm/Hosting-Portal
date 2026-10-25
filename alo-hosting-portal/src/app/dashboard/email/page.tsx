'use client'

import { useState, useEffect } from 'react'
import { Mail, Plus, Search, ExternalLink, Trash2, MoreVertical } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

interface EmailAccount {
  id: string
  email: string
  provider: string
  quota: number
  usedQuota: number
  status: string
  createdAt: string
}

export default function EmailPage() {
  const { token, isAuthenticated } = useAuthStore()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [creating, setCreating] = useState(false)
  const [quotaMb, setQuotaMb] = useState('5000')
  const [search, setSearch] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const refreshAccounts = async () => {
    if (!token) return
    try {
      const res = await fetch('/api/email/accounts', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setAccounts(data.accounts || [])
      }
    } catch {
      // Silently fail
    }
  }

  useEffect(() => {
    if (!isAuthenticated || !token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/email/accounts', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!cancelled && res.ok) {
          const data = await res.json()
          setAccounts(data.accounts || [])
        }
      } catch {
        // Silently fail
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isAuthenticated, token])

  const handleCreate = async () => {
    if (!newEmail.trim() || !token) return
    setCreating(true)
    try {
      const res = await fetch('/api/email/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: newEmail, quotaMb: parseInt(quotaMb, 10) }),
      })
      if (res.ok) {
        toast.success('Email account created successfully!')
        setShowCreate(false)
        setNewEmail('')
        refreshAccounts()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create email account')
      }
    } catch {
      toast.error('Something went wrong')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!token) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/email/accounts/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        toast.success('Email account deleted')
        setAccounts((prev) => prev.filter((a) => a.id !== id))
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to delete email account')
      }
    } catch {
      toast.error('Something went wrong')
    } finally {
      setDeletingId(null)
    }
  }

  const filteredAccounts = accounts.filter(
    (a) =>
      a.email.toLowerCase().includes(search.toLowerCase())
  )

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-[#475569]">Please sign in to manage email accounts.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B]">Email Accounts</h1>
          <p className="text-[#475569] mt-1">Manage your professional business email addresses</p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-[#E8501A] hover:bg-[#C73D12] text-white"
        >
          <Plus className="size-4 mr-2" />
          New Email
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-[#475569]">Total Accounts</p>
            <p className="text-3xl font-bold text-[#1E293B] mt-1">{accounts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-[#475569]">Active</p>
            <p className="text-3xl font-bold text-green-600 mt-1">
              {accounts.filter((a) => a.status === 'active').length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-[#475569]">Total Storage Used</p>
            <p className="text-3xl font-bold text-[#E8501A] mt-1">
              {accounts.reduce((sum, a) => sum + a.usedQuota, 0)} MB
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#475569]" />
        <Input
          placeholder="Search email accounts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Accounts List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filteredAccounts.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Mail className="size-12 text-[#475569]/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#1E293B]">
              {search ? 'No matching accounts' : 'No email accounts yet'}
            </h3>
            <p className="text-sm text-[#475569] mt-1">
              {search
                ? 'Try a different search term'
                : 'Create your first professional email address to get started.'}
            </p>
            {!search && (
              <Button
                onClick={() => setShowCreate(true)}
                className="mt-4 bg-[#E8501A] hover:bg-[#C73D12] text-white"
              >
                <Plus className="size-4 mr-2" />
                Create Email Account
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredAccounts.map((account) => (
            <Card key={account.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E8501A]/10">
                      <Mail className="size-5 text-[#E8501A]" />
                    </div>
                    <div>
                      <p className="font-medium text-[#1E293B]">{account.email}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge
                          variant="secondary"
                          className="text-xs capitalize"
                        >
                          {account.provider}
                        </Badge>
                        <span className="text-xs text-[#475569]">
                          {account.usedQuota} MB / {account.quota} MB used
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={
                        account.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-700'
                      }
                    >
                      {account.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50"
                      disabled={deletingId === account.id}
                      onClick={() => handleDelete(account.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Email Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label htmlFor="new-email">Email Address</Label>
              <div className="flex items-center gap-0">
                <Input
                  id="new-email"
                  placeholder="info"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="rounded-r-none"
                />
                <div className="flex items-center h-10 px-3 bg-gray-100 border border-l-0 border-input rounded-r-md text-sm text-[#475569]">
                  @alolabs.net
                </div>
              </div>
              <p className="text-xs text-[#475569]">
                Your email will be: {newEmail || 'info'}@alolabs.net
              </p>
            </div>

            <div className="space-y-2">
              <Label>Mailbox Quota</Label>
              <Select value={quotaMb} onValueChange={setQuotaMb}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1000">1 GB</SelectItem>
                  <SelectItem value="5000">5 GB</SelectItem>
                  <SelectItem value="10000">10 GB</SelectItem>
                  <SelectItem value="25000">25 GB</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleCreate}
              disabled={!newEmail.trim() || creating}
              className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white"
            >
              {creating ? 'Creating...' : 'Create Email Account'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}