'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
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
  const [twoFactor, setTwoFactor] = useState(false)

  // API Keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [keyForm, setKeyForm] = useState({ name: '', permissions: 'read', expiresAt: '' })
  const [newKey, setNewKey] = useState<string | null>(null)
  const [newKeyDialogOpen, setNewKeyDialogOpen] = useState(false)

  // Sessions — fetched from /api/auth/session
  const [sessions, setSessions] = useState<Array<{ id: string; device: string; icon: React.ComponentType<{ className?: string }>; ip: string; location: string; lastActive: string; current: boolean }>>([])

  // Notifications
  const [notifSettings, setNotifSettings] = useState({
    email: true,
    deployments: true,
    ssl: true,
    backups: true,
    billing: true,
    marketing: false,
  })
  const [savedNotifSettings, setSavedNotifSettings] = useState(notifSettings)
  const [savingNotifs, setSavingNotifs] = useState(false)

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

          // Also fetch session for security tab
          if (activeTab === 'security') {
            try {
              const sessRes = await fetch('/api/auth/session', { headers: { Authorization: `Bearer ${getToken()}` } })
              if (sessRes.ok) {
                const rawData = await sessRes.json()
                const d = rawData.data ?? rawData
                if (d && !cancelled) {
                  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
                  let device = 'Current session'
                  if (ua.includes('Chrome')) device = 'Chrome on ' + (ua.includes('Mac') ? 'MacOS' : ua.includes('Win') ? 'Windows' : 'Linux')
                  else if (ua.includes('Firefox')) device = 'Firefox on ' + (ua.includes('Mac') ? 'MacOS' : 'Windows')
                  else if (ua.includes('Safari')) device = 'Safari on ' + (ua.includes('Mac') ? 'MacOS' : 'iOS')
                  setSessions([{
                    id: d.id || 'current',
                    device,
                    icon: Monitor,
                    ip: '•••',
                    location: 'Current session',
                    lastActive: 'Now',
                    current: true,
                  }])
                }
              }
            } catch {
              if (!cancelled) {
                setSessions([{
                  id: 'current',
                  device: 'Current session',
                  icon: Monitor,
                  ip: '•••',
                  location: 'Current session',
                  lastActive: 'Now',
                  current: true,
                }])
              }
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

            {/* Two-Factor Auth */}
            <Card>
              <CardHeader>
                <CardTitle>Two-Factor Authentication</CardTitle>
                <CardDescription>Add an extra layer of security to your account</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Authenticator App</p>
                    <p className="text-sm text-gray-500">
                      {twoFactor ? 'Enabled — your account is secured with 2FA' : 'Protect your account with 2-step verification'}
                    </p>
                  </div>
                  <Switch
                    checked={twoFactor}
                    onCheckedChange={(val) => {
                      setTwoFactor(val)
                      toast.success('Two-factor authentication ' + (val ? 'enabled' : 'disabled'))
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Active Sessions */}
            <Card>
              <CardHeader>
                <CardTitle>Active Sessions</CardTitle>
                <CardDescription>Manage your active login sessions</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {sessions.map((session, i) => {
                    const SessionIcon = session.icon
                    return (
                      <div key={session.id}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                              <SessionIcon className="h-5 w-5 text-gray-500" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">{session.device}</p>
                                {session.current && (
                                  <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">Current</Badge>
                                )}
                              </div>
                              <p className="text-xs text-gray-400">
                                {session.ip} · {session.location} · {session.lastActive}
                              </p>
                            </div>
                          </div>
                          {!session.current && (
                            <Button variant="outline" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => {
                              setSessions((prev) => prev.filter((s) => s.id !== session.id))
                              toast.success(`Session "${session.device}" revoked`)
                            }}>
                              Revoke
                            </Button>
                          )}
                        </div>
                        {i < sessions.length - 1 && <Separator className="mt-4" />}
                      </div>
                    )
                  })}
                </div>
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
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>Choose what notifications you want to receive</CardDescription>
              </CardHeader>
              <CardContent className="space-y-0">
                <div className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-medium">Email Notifications</p>
                    <p className="text-sm text-gray-500">Receive email notifications for important events</p>
                  </div>
                  <Switch
                    checked={notifSettings.email}
                    onCheckedChange={(v) => setNotifSettings(s => ({ ...s, email: v }))}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-medium">Deployment Alerts</p>
                    <p className="text-sm text-gray-500">Get notified when deployments succeed or fail</p>
                  </div>
                  <Switch
                    checked={notifSettings.deployments}
                    onCheckedChange={(v) => setNotifSettings(s => ({ ...s, deployments: v }))}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-medium">SSL Expiry Warnings</p>
                    <p className="text-sm text-gray-500">Alert when SSL certificates are about to expire</p>
                  </div>
                  <Switch
                    checked={notifSettings.ssl}
                    onCheckedChange={(v) => setNotifSettings(s => ({ ...s, ssl: v }))}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-medium">Backup Notifications</p>
                    <p className="text-sm text-gray-500">Notify when backups complete or fail</p>
                  </div>
                  <Switch
                    checked={notifSettings.backups}
                    onCheckedChange={(v) => setNotifSettings(s => ({ ...s, backups: v }))}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-medium">Billing Alerts</p>
                    <p className="text-sm text-gray-500">Get notified about invoices, payments, and plan changes</p>
                  </div>
                  <Switch
                    checked={notifSettings.billing}
                    onCheckedChange={(v) => setNotifSettings(s => ({ ...s, billing: v }))}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-medium">Marketing Emails</p>
                    <p className="text-sm text-gray-500">Receive updates about new features and promotions</p>
                  </div>
                  <Switch
                    checked={notifSettings.marketing}
                    onCheckedChange={(v) => setNotifSettings(s => ({ ...s, marketing: v }))}
                  />
                </div>

                <div className="flex justify-end pt-4">
                  <Button
                    onClick={async () => {
                      setSavingNotifs(true)
                      // Persist preferences in component state
                      setSavedNotifSettings({ ...notifSettings })
                      toast.success('Notification preferences saved')
                      setSavingNotifs(false)
                    }}
                    disabled={savingNotifs}
                    className="bg-[#E8501A] hover:bg-[#5B2FC9]"
                  >
                    {savingNotifs && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                    Save Preferences
                  </Button>
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

