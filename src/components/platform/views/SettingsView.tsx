'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import {
  User as UserIcon,
  Shield,
  Key,
  Bell,
  AlertCircle,
  Copy,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  Monitor,
  Loader2,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

interface UserProfile {
  id: string
  name: string | null
  email: string
  phone: string | null
  company: string | null
  plan: string
  role: string
  avatar: string | null
  createdAt: string
}

interface ApiKey {
  id: string
  name: string
  key: string
  permissions: string
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

// Sessions are now fetched from /api/auth/session at runtime

export default function SettingsView() {
  const [activeTab, setActiveTab] = useState('profile')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Profile
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileForm, setProfileForm] = useState({ name: '', phone: '', company: '' })
  const [savingProfile, setSavingProfile] = useState(false)

  // Security
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' })
  const [changingPassword, setChangingPassword] = useState(false)
  const [showPasswords, setShowPasswords] = useState({ current: false, newPass: false, confirm: false })

  // Two-factor authentication. State comes from /api/user/mfa and every change
  // goes through the API: a control that reports "enabled" without the server
  // agreeing is worse than no control, because it is trusted.
  const [mfa, setMfa] = useState<{ enabled: boolean; method: string | null; verified: boolean } | null>(null)
  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaEnroll, setMfaEnroll] = useState<{ secret: string; qrUrl: string; backupCodes: string[] } | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaDisableCode, setMfaDisableCode] = useState('')
  const [mfaShowDisable, setMfaShowDisable] = useState(false)

  // API Keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [keyForm, setKeyForm] = useState({ name: '', permissions: 'read', expiresAt: '' })
  const [newKey, setNewKey] = useState<string | null>(null)
  const [newKeyDialogOpen, setNewKeyDialogOpen] = useState(false)

  // Sessions come from /api/security/sessions, which reads the real session
  // table. The previous version synthesized a single "Current session" row from
  // navigator.userAgent and then removed it from local state on "Revoke", so the
  // list looked managed while no session was ever actually revoked.
  const [sessions, setSessions] = useState<Array<{
    id: string
    ipAddress: string | null
    userAgent: string | null
    expiresAt: string
    createdAt: string
    isCurrent: boolean
  }>>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [revokingSession, setRevokingSession] = useState<string | null>(null)

  // Notification preferences have no persistence behind them; the card in the
  // notifications tab says so rather than pretending to save local state.

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (activeTab === 'profile' || activeTab === 'security') {
          const res = await fetch('/api/user/profile', { headers: { Authorization: `Bearer ${getToken()}` } })
          if (!res.ok) throw new Error('Failed to fetch profile')
          const data = await res.json()
          if (!cancelled) {
            setProfile(data.user)
            setProfileForm({
              name: data.user.name || '',
              phone: data.user.phone || '',
              company: data.user.company || '',
            })
            setError(null)
            setLoading(false)
          }

          // Security tab: real MFA status and real sessions.
          if (activeTab === 'security') {
            setMfaLoading(true)
            setSessionsLoading(true)
            const authHeaders = { Authorization: `Bearer ${getToken()}` }
            const [mfaRes, sessRes] = await Promise.allSettled([
              fetch('/api/user/mfa', { headers: authHeaders }),
              fetch('/api/security/sessions', { headers: authHeaders }),
            ])

            if (!cancelled) {
              if (mfaRes.status === 'fulfilled' && mfaRes.value.ok) {
                const raw = await mfaRes.value.json()
                const d = raw?.data ?? raw
                setMfa({
                  enabled: Boolean(d?.enabled),
                  method: d?.method ?? null,
                  verified: Boolean(d?.verified),
                })
              } else {
                // Unknown is rendered as unknown. Defaulting to "disabled" would
                // tell a user with 2FA turned on that it is off.
                setMfa(null)
              }
              setMfaLoading(false)
            }

            if (!cancelled) {
              if (sessRes.status === 'fulfilled' && sessRes.value.ok) {
                const raw = await sessRes.value.json()
                const d = raw?.data ?? raw
                setSessions(Array.isArray(d) ? d : [])
              } else {
                setSessions([])
              }
              setSessionsLoading(false)
            }
          }
        } else if (activeTab === 'api-keys') {
          const res = await fetch('/api/settings/api-keys', { headers: { Authorization: `Bearer ${getToken()}` } })
          if (!res.ok) throw new Error('Failed to fetch API keys')
          const data = await res.json()
          if (!cancelled) {
            setApiKeys(Array.isArray(data) ? data : [])
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

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/user/profile', { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error('Failed to fetch profile')
      const data = await res.json()
      setProfile(data.user)
      setProfileForm({
        name: data.user.name || '',
        phone: data.user.phone || '',
        company: data.user.company || '',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const fetchApiKeys = async () => {
    try {
      const res = await fetch('/api/settings/api-keys', { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error('Failed to fetch API keys')
      const data = await res.json()
      setApiKeys(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  // Profile save
  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(profileForm),
      })
      if (!res.ok) throw new Error('Failed to update profile')
      toast.success('Profile updated successfully')
      await fetchProfile()
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  // Password change
  const handleChangePassword = async () => {
    if (passwordForm.newPass !== passwordForm.confirm) {
      toast.error('Passwords do not match')
      return
    }
    if (passwordForm.newPass.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    setChangingPassword(true)
    try {
      const res = await fetch('/api/user/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ currentPassword: passwordForm.current, newPassword: passwordForm.newPass }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to change password')
      }
      toast.success('Password changed successfully')
      setPasswordForm({ current: '', newPass: '', confirm: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  // API Key handlers
  const handleGenerateKey = async () => {
    if (!keyForm.name.trim()) return
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          name: keyForm.name,
          permissions: keyForm.permissions,
          expiresAt: keyForm.expiresAt || undefined,
        }),
      })
      if (!res.ok) throw new Error('Failed to generate key')
      const data = await res.json()
      setNewKey(data.key)
      setNewKeyDialogOpen(true)
      setKeyDialogOpen(false)
      setKeyForm({ name: '', permissions: 'read', expiresAt: '' })
      await fetchApiKeys()
    } catch {
      toast.error('Failed to generate API key')
    }
  }

  const handleDeleteKey = async (id: string) => {
    try {
      const res = await fetch(`/api/settings/api-keys?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) throw new Error('Failed to delete key')
      toast.success('API key deleted')
      await fetchApiKeys()
    } catch {
      toast.error('Failed to delete API key')
    }
  }

  // ── Two-factor authentication ──────────────────────────────────────────────
  // Every one of these reads the outcome back from the server before the UI
  // claims anything. "Enabled" is only ever shown because /api/user/mfa said so.

  const refreshMfa = async () => {
    try {
      const res = await fetch('/api/user/mfa', { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error('request failed')
      const raw = await res.json()
      const d = raw?.data ?? raw
      setMfa({ enabled: Boolean(d?.enabled), method: d?.method ?? null, verified: Boolean(d?.verified) })
    } catch {
      setMfa(null)
    }
  }

  const apiErrorMessage = async (res: Response, fallback: string) => {
    try {
      const raw = await res.json()
      return raw?.error?.message ?? raw?.message ?? raw?.error ?? fallback
    } catch {
      return fallback
    }
  }

  const handleStartMfa = async () => {
    setMfaLoading(true)
    try {
      const res = await fetch('/api/user/mfa', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'totp' }),
      })
      if (!res.ok) {
        toast.error(await apiErrorMessage(res, 'Could not start two-factor setup'))
        return
      }
      const raw = await res.json()
      const d = raw?.data ?? raw
      setMfaEnroll({ secret: d.secret, qrUrl: d.qrUrl, backupCodes: d.backupCodes ?? [] })
      setMfaCode('')
      // Enrollment created a pending, NOT enabled, record.
      await refreshMfa()
    } catch {
      toast.error('Could not start two-factor setup')
    } finally {
      setMfaLoading(false)
    }
  }

  const handleVerifyMfa = async () => {
    if (mfaCode.trim().length !== 6) {
      toast.error('Enter the 6-digit code from your authenticator app')
      return
    }
    setMfaLoading(true)
    try {
      const res = await fetch('/api/user/mfa/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: mfaCode.trim() }),
      })
      if (!res.ok) {
        toast.error(await apiErrorMessage(res, 'That code was not accepted'))
        return
      }
      // Claim success only once the server confirms it, by re-reading the
      // status rather than trusting the 200 or the local state we just set.
      const check = await fetch('/api/user/mfa', { headers: { Authorization: `Bearer ${getToken()}` } })
      const rawCheck = check.ok ? await check.json() : null
      const confirmed = rawCheck?.data ?? rawCheck
      setMfa({
        enabled: Boolean(confirmed?.enabled),
        method: confirmed?.method ?? null,
        verified: Boolean(confirmed?.verified),
      })
      if (confirmed?.enabled) {
        toast.success('Two-factor authentication is enabled')
        setMfaCode('')
        setMfaEnroll(null)
      } else {
        toast.error('The server did not confirm two-factor as enabled; enter the code again')
      }
    } catch {
      toast.error('Could not verify that code')
    } finally {
      setMfaLoading(false)
    }
  }

  const handleDisableMfa = async () => {
    if (!mfaDisableCode.trim()) {
      toast.error('Enter a current code or a backup code to turn off two-factor')
      return
    }
    setMfaLoading(true)
    try {
      const res = await fetch('/api/user/mfa/disable', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: mfaDisableCode.trim() }),
      })
      if (!res.ok) {
        toast.error(await apiErrorMessage(res, 'Two-factor was not disabled'))
        return
      }
      await refreshMfa()
      setMfaDisableCode('')
      setMfaShowDisable(false)
      toast.success('Two-factor authentication is disabled')
    } catch {
      toast.error('Could not disable two-factor')
    } finally {
      setMfaLoading(false)
    }
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  const fetchSessions = async () => {
    setSessionsLoading(true)
    try {
      const res = await fetch('/api/security/sessions', { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error('request failed')
      const raw = await res.json()
      const d = raw?.data ?? raw
      setSessions(Array.isArray(d) ? d : [])
    } catch {
      setSessions([])
    } finally {
      setSessionsLoading(false)
    }
  }

  const handleRevokeSession = async (id: string) => {
    setRevokingSession(id)
    try {
      const res = await fetch(`/api/security/sessions?sessionId=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) {
        toast.error(await apiErrorMessage(res, 'That session was not revoked'))
        return
      }
      const raw = await res.json()
      const revoked = raw?.data?.revoked ?? 0
      // Report what the server actually deleted, not what the button intended.
      if (revoked > 0) toast.success(`Revoked ${revoked} session${revoked === 1 ? '' : 's'}`)
      else toast.error('The server revoked 0 sessions')
      await fetchSessions()
    } catch {
      toast.error('Could not revoke that session')
    } finally {
      setRevokingSession(null)
    }
  }

  const handleRevokeOtherSessions = async () => {
    setRevokingSession('all')
    try {
      const res = await fetch('/api/security/sessions?all=true', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) {
        toast.error(await apiErrorMessage(res, 'Other sessions were not revoked'))
        return
      }
      const raw = await res.json()
      const revoked = raw?.data?.revoked ?? 0
      toast.success(`Revoked ${revoked} other session${revoked === 1 ? '' : 's'}`)
      await fetchSessions()
    } catch {
      toast.error('Could not revoke other sessions')
    } finally {
      setRevokingSession(null)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  const maskKey = (key: string) => {
    if (key.length <= 12) return key
    return key.slice(0, 8) + '...' + key.slice(-4)
  }

  const initials = profile?.name
    ?.split(' ')
    .map((n) => n.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U'

  const permissionsColor = (perm: string) => {
    switch (perm) {
      case 'admin': return 'bg-red-100 text-red-700'
      case 'write': return 'bg-yellow-100 text-yellow-700'
      default: return 'bg-purple-100 text-purple-700'
    }
  }

  return (
    <div className="p-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="profile" className="gap-1.5"><UserIcon className="h-3.5 w-3.5" /> Profile</TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5"><Shield className="h-3.5 w-3.5" /> Security</TabsTrigger>
          <TabsTrigger value="api-keys" className="gap-1.5"><Key className="h-3.5 w-3.5" /> API Keys</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5"><Bell className="h-3.5 w-3.5" /> Notifications</TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-80 rounded-xl" />
            </div>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6 max-w-2xl">
              {/* Avatar Section */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-5">
                    <Avatar className="h-20 w-20 bg-[#E8501A]/20">
                      <AvatarFallback className="text-2xl font-semibold text-[#E8501A] bg-[#E8501A]/10">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h2 className="text-lg font-semibold">{profile?.name || 'User'}</h2>
                      <p className="text-sm text-gray-500">{profile?.email}</p>
                      <Badge variant="secondary" className="mt-1.5 capitalize bg-[#E8501A]/10 text-[#E8501A]">
                        {profile?.plan || 'free'} Plan
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Profile Form */}
              <Card>
                <CardHeader>
                  <CardTitle>Personal Information</CardTitle>
                  <CardDescription>Update your personal details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Full Name</Label>
                      <Input
                        value={profileForm.name}
                        onChange={(e) => setProfileForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="John Doe"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email (read-only)</Label>
                      <Input value={profile?.email || ''} disabled className="bg-gray-50" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm(f => ({ ...f, phone: e.target.value }))}
                        placeholder="+1 (555) 123-4567"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Company</Label>
                      <Input
                        value={profileForm.company}
                        onChange={(e) => setProfileForm(f => ({ ...f, company: e.target.value }))}
                        placeholder="Acme Inc."
                      />
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <Button
                      onClick={handleSaveProfile}
                      disabled={savingProfile}
                      className="bg-[#E8501A] hover:bg-[#5B2FC9]"
                    >
                      {savingProfile && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                      Save Changes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <div className="space-y-6 max-w-2xl">
            {/* Change Password */}
            <Card>
              <CardHeader>
                <CardTitle>Change Password</CardTitle>
                <CardDescription>Ensure your account uses a strong password</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Current Password</Label>
                  <div className="relative">
                    <Input
                      type={showPasswords.current ? 'text' : 'password'}
                      value={passwordForm.current}
                      onChange={(e) => setPasswordForm(f => ({ ...f, current: e.target.value }))}
                      placeholder="Enter current password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswords(s => ({ ...s, current: !s.current }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPasswords.current ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>New Password</Label>
                    <div className="relative">
                      <Input
                        type={showPasswords.newPass ? 'text' : 'password'}
                        value={passwordForm.newPass}
                        onChange={(e) => setPasswordForm(f => ({ ...f, newPass: e.target.value }))}
                        placeholder="Min. 8 characters"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords(s => ({ ...s, newPass: !s.newPass }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPasswords.newPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Confirm New Password</Label>
                    <div className="relative">
                      <Input
                        type={showPasswords.confirm ? 'text' : 'password'}
                        value={passwordForm.confirm}
                        onChange={(e) => setPasswordForm(f => ({ ...f, confirm: e.target.value }))}
                        placeholder="Re-enter new password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPasswords(s => ({ ...s, confirm: !s.confirm }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPasswords.confirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleChangePassword}
                    disabled={changingPassword || !passwordForm.current || !passwordForm.newPass}
                    className="bg-[#E8501A] hover:bg-[#5B2FC9]"
                  >
                    {changingPassword && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                    Change Password
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Two-Factor Auth — wired to /api/user/mfa. The status shown is the
                status the server reported, and it is only "enabled" after
                /api/user/mfa/verify has confirmed it. */}
            <Card>
              <CardHeader>
                <CardTitle>Two-Factor Authentication</CardTitle>
                <CardDescription>Add an extra layer of security to your account</CardDescription>
              </CardHeader>
              <CardContent>
                {mfaLoading && !mfa ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-4 w-64" />
                  </div>
                ) : mfa === null ? (
                  <div className="flex items-start gap-2 text-sm text-amber-700">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>
                      Two-factor status could not be loaded, so it is shown as unknown rather than
                      guessed. <button type="button" className="underline" onClick={refreshMfa}>Try again</button>
                    </p>
                  </div>
                ) : mfa.enabled ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Authenticator App</p>
                        <p className="text-sm text-gray-500">
                          Enabled{(mfa.method ? ` — method ${mfa.method.toUpperCase()}` : '')}. Your account is secured with 2FA.
                        </p>
                      </div>
                      <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">Enabled</Badge>
                    </div>
                    {!mfaShowDisable ? (
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setMfaShowDisable(true)}>
                          Turn off
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                        <p className="text-xs text-red-700">
                          Turning off two-factor requires a current 6-digit code or one of your backup
                          codes. The server verifies it before anything changes.
                        </p>
                        <div className="flex gap-2">
                          <Input
                            value={mfaDisableCode}
                            onChange={(e) => setMfaDisableCode(e.target.value)}
                            placeholder="Code or backup code"
                            autoComplete="one-time-code"
                            className="bg-white"
                          />
                          <Button variant="outline" size="sm" disabled={mfaLoading} onClick={() => { setMfaShowDisable(false); setMfaDisableCode('') }}>
                            Cancel
                          </Button>
                          <Button variant="destructive" size="sm" disabled={mfaLoading || !mfaDisableCode.trim()} onClick={handleDisableMfa}>
                            {mfaLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            Turn off 2FA
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : mfaEnroll ? (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">
                      Add this account to your authenticator app, then enter the 6-digit code it shows.
                      Two-factor stays <strong>off</strong> until the server verifies that code.
                    </p>
                    <div className="space-y-1.5">
                      <Label>Setup key</Label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 break-all rounded-md bg-gray-50 px-3 py-2 text-xs">
                          {mfaEnroll.secret}
                        </code>
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(mfaEnroll.secret)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500">
                        Or import this URI directly:
                      </p>
                      <code className="block break-all rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                        {mfaEnroll.qrUrl}
                      </code>
                    </div>
                    {mfaEnroll.backupCodes.length > 0 && (
                      <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-medium text-amber-800">
                          Backup codes — shown once. Store them now; they are the only way in if you
                          lose your device.
                        </p>
                        <div className="grid grid-cols-2 gap-1">
                          {mfaEnroll.backupCodes.map((code) => (
                            <code key={code} className="text-xs text-amber-900">{code}</code>
                          ))}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => copyToClipboard(mfaEnroll.backupCodes.join('\n'))}>
                          <Copy className="h-4 w-4 mr-1.5" />
                          Copy backup codes
                        </Button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                      />
                      <Button onClick={handleVerifyMfa} disabled={mfaLoading || mfaCode.trim().length !== 6} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
                        {mfaLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                        Verify and enable
                      </Button>
                      <Button variant="outline" onClick={() => { setMfaEnroll(null); setMfaCode('') }} disabled={mfaLoading}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Authenticator App</p>
                      <p className="text-sm text-gray-500">
                        {mfa.verified
                          ? 'Set up but not enabled yet — finish verification to turn it on.'
                          : 'Protect your account with 2-step verification.'}
                      </p>
                    </div>
                    <Button onClick={handleStartMfa} disabled={mfaLoading} variant="outline" size="sm">
                      {mfaLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                      {mfa.verified ? 'Restart setup' : 'Set up 2FA'}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Active Sessions — read from /api/security/sessions, revoked through
                the same endpoint. Revocation reports the count the server deleted. */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>Active Sessions</CardTitle>
                    <CardDescription>Manage your active login sessions</CardDescription>
                  </div>
                  {sessions.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revokingSession !== null}
                      onClick={handleRevokeOtherSessions}
                    >
                      {revokingSession === 'all' && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                      Revoke all others
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {sessionsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : sessions.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No active sessions were found for this account. Sessions created before session
                    tracking was enabled will not appear here.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {sessions.map((session, i) => (
                      <div key={session.id}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                              <Monitor className="h-5 w-5 text-gray-500" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-medium">
                                  {session.userAgent?.slice(0, 80) || 'Unknown client'}
                                </p>
                                {session.isCurrent && (
                                  <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">Current</Badge>
                                )}
                              </div>
                              <p className="text-xs text-gray-400">
                                {session.ipAddress || 'IP not recorded'}
                                {' · '}
                                started {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
                                {' · '}
                                expires {format(new Date(session.expiresAt), 'PPP')}
                              </p>
                            </div>
                          </div>
                          {!session.isCurrent && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-500 hover:text-red-600 hover:bg-red-50"
                              disabled={revokingSession !== null}
                              onClick={() => handleRevokeSession(session.id)}
                            >
                              {revokingSession === session.id && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                              Revoke
                            </Button>
                          )}
                        </div>
                        {i < sessions.length - 1 && <Separator className="mt-4" />}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* API Keys Tab */}
        <TabsContent value="api-keys">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setKeyDialogOpen(true)} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              <Plus className="h-4 w-4 mr-1.5" />
              Generate API Key
            </Button>
          </div>

          {loading ? (
            <Card>
              <CardContent className="p-0">
                {[...Array(3)].map((_, i) => (
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
          ) : apiKeys.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Key className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No API keys</h3>
                <p className="text-sm text-gray-400 mt-1">Generate an API key to access the platform programmatically</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Permissions</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-28"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {apiKeys.map((apiKey) => (
                      <TableRow key={apiKey.id}>
                        <TableCell className="font-medium">{apiKey.name}</TableCell>
                        <TableCell className="font-mono text-sm text-gray-500">
                          {maskKey(apiKey.key)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={permissionsColor(apiKey.permissions)}>
                            {apiKey.permissions}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-400 text-sm">
                          {apiKey.lastUsedAt
                            ? formatDistanceToNow(new Date(apiKey.lastUsedAt), { addSuffix: true })
                            : 'Never'}
                        </TableCell>
                        <TableCell className="text-gray-400 text-sm">
                          {apiKey.expiresAt
                            ? format(new Date(apiKey.expiresAt), 'MMM d, yyyy')
                            : 'Never'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => copyToClipboard(apiKey.key)}
                            >
                              <Copy className="h-4 w-4 text-gray-400" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-400 hover:text-red-500"
                              onClick={() => handleDeleteKey(apiKey.id)}
                            >
                              <Trash2 className="h-4 w-4" />
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

        {/* Notifications Tab */}
        <TabsContent value="notifications">
          <div className="max-w-2xl">
            {/* Notification preferences have no storage behind them: there is no
                preference model in prisma/schema.prisma and no endpoint that
                accepts one. Rendering live toggles plus a "saved" toast told
                users their choices were stored when nothing was, so the card
                states the real status instead. */}
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>Choose what notifications you want to receive</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700" />
                  <div className="text-sm text-amber-900">
                    <p className="font-medium">Not available yet</p>
                    <p className="mt-1 text-amber-800">
                      Per-channel notification preferences are not stored anywhere in this
                      deployment, so there is nothing to save. Notifications themselves are
                      delivered through <code className="text-xs">/api/notifications</code> and the
                      alerting rules under <code className="text-xs">/api/alerts/rules</code>, which
                      do persist.
                    </p>
                    <p className="mt-2 text-amber-800">
                      To enable these preferences, add a <code className="text-xs">NotificationPreference</code> model
                      to <code className="text-xs">prisma/schema.prisma</code> (one row per user, one boolean per
                      channel) with an additive migration, then expose it through
                      <code className="text-xs"> /api/settings</code> and restore the toggles here.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Generate API Key Dialog */}
      <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Key Name</Label>
              <Input
                value={keyForm.name}
                onChange={(e) => setKeyForm(f => ({ ...f, name: e.target.value }))}
                placeholder="My API Key"
              />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <Select value={keyForm.permissions} onValueChange={(v) => setKeyForm(f => ({ ...f, permissions: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">Read</SelectItem>
                  <SelectItem value="write">Write</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Expiry Date (optional)</Label>
              <Input
                type="date"
                value={keyForm.expiresAt}
                onChange={(e) => setKeyForm(f => ({ ...f, expiresAt: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKeyDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleGenerateKey} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              Generate Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Key Display Dialog */}
      <Dialog open={newKeyDialogOpen} onOpenChange={setNewKeyDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>API Key Generated</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-gray-600">
              Make sure to copy your API key now. You won&apos;t be able to see it again.
            </p>
            <div className="flex items-center gap-2">
              <Input value={newKey || ''} readOnly className="font-mono text-sm bg-gray-50" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => newKey && copyToClipboard(newKey)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKeyDialogOpen(false)} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

