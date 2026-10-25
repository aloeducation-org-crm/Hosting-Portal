'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import {
  User,
  Mail,
  Phone,
  Building2,
  Save,
  Lock,
  Trash2,
  ShieldCheck,
  Crown,
  ArrowRight,
  Loader2,
  CheckCircle2,
} from 'lucide-react'

interface ProfileData {
  id: string
  name: string
  email: string
  phone: string | null
  company: string | null
  plan: string
  role: string
  avatar: string | null
  createdAt: string
}

const planInfo: Record<string, { label: string; price: string; color: string }> = {
  free: { label: 'Free', price: '$0/mo', color: 'bg-gray-100 text-gray-700 border-gray-200' },
  starter: { label: 'Starter', price: '$2.99/mo', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  premium: { label: 'Premium', price: '$3.99/mo', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  business: { label: 'Business', price: '$7.99/mo', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

export default function SettingsPage() {
  const router = useRouter()
  const { user, token, logout } = useAuthStore()
  const { toast } = useToast()

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Profile form state
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!cancelled && res.ok) {
          const data = await res.json()
          setProfile(data.user)
          setName(data.user.name || '')
          setPhone(data.user.phone || '')
          setCompany(data.user.company || '')
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch profile:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleSaveProfile = async () => {
    if (!token) return
    setSaving(true)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, phone: phone || null, company: company || null }),
      })

      if (res.ok) {
        const data = await res.json()
        setProfile(data.user)
        toast({
          title: 'Profile updated',
          description: 'Your profile information has been saved.',
        })
      } else {
        const data = await res.json()
        toast({
          title: 'Error',
          description: data.error || 'Failed to update profile.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordError('')
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (!token) return

    setChangingPassword(true)
    try {
      const res = await fetch('/api/user/password', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      if (res.ok) {
        toast({
          title: 'Password changed',
          description: 'Your password has been updated successfully.',
        })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        const data = await res.json()
        setPasswordError(data.error || 'Failed to change password.')
      }
    } catch {
      setPasswordError('Something went wrong.')
    } finally {
      setChangingPassword(false)
    }
  }

  const plan = profile?.plan || user?.plan || 'free'
  const currentPlan = (planInfo[plan] || planInfo.free)!

  if (loading) {
    return (
      <div className="space-y-6 max-w-3xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold text-[#1E293B]">Settings</h1>
        <p className="text-[#475569] mt-1">
          Manage your account settings and preferences.
        </p>
      </div>

      {/* Profile Settings */}
      <Card className="border-[#E2E8F0] p-0 overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-[#E8501A]" />
            <CardTitle className="text-base font-semibold text-[#1E293B]">
              Profile Information
            </CardTitle>
          </div>
          <CardDescription>
            Update your personal details and contact information.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-[#1E293B]">
                Full Name
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-[#1E293B]">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                <Input
                  id="email"
                  value={profile?.email || user?.email || ''}
                  disabled
                  className="pl-9 bg-[#FFF7ED]/50 text-[#475569]"
                />
              </div>
              <p className="text-xs text-[#9CA3AF]">
                Email cannot be changed. Contact support if needed.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-[#1E293B]">
                Phone Number
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="company" className="text-[#1E293B]">
                Company
              </Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                <Input
                  id="company"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Your Company"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveProfile}
              disabled={saving}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white min-w-32"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save Changes
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card className="border-[#E2E8F0] p-0 overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-[#E8501A]" />
            <CardTitle className="text-base font-semibold text-[#1E293B]">
              Change Password
            </CardTitle>
          </div>
          <CardDescription>
            Update your password to keep your account secure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword" className="text-[#1E293B]">
              Current Password
            </Label>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-[#1E293B]">
                New Password
              </Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-[#1E293B]">
                Confirm New Password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
              />
            </div>
          </div>

          {passwordError && (
            <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {passwordError}
            </p>
          )}

          <div className="flex justify-end pt-2">
            <Button
              onClick={handleChangePassword}
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              variant="outline"
              className="border-[#E8501A] text-[#E8501A] hover:bg-[#E8501A] hover:text-white min-w-40"
            >
              {changingPassword ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <ShieldCheck className="h-4 w-4 mr-1" />
              )}
              Update Password
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Plan Display */}
      <Card className="border-[#E2E8F0] p-0 overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-[#E8501A]" />
            <CardTitle className="text-base font-semibold text-[#1E293B]">
              Your Plan
            </CardTitle>
          </div>
          <CardDescription>
            Manage your subscription and billing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#F9F8FC] border border-[#E2E8F0]">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8501A]/10">
                <Crown className="h-6 w-6 text-[#E8501A]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-[#1E293B] capitalize">
                    {currentPlan.label}
                  </h3>
                  <Badge
                    variant="outline"
                    className={cn('text-xs capitalize', currentPlan.color)}
                  >
                    Current
                  </Badge>
                </div>
                <p className="text-sm text-[#475569] mt-0.5">
                  {currentPlan.price}
                </p>
              </div>
            </div>

            {plan !== 'business' && (
              <Button
                onClick={() => router.push('/dashboard/billing')}
                className="bg-[#E8501A] hover:bg-[#C73D12] text-white shrink-0"
              >
                Upgrade Plan
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(['starter', 'premium', 'business'] as const)
              .filter((p) => p !== plan)
              .slice(0, 2)
              .map((p) => {
                const info = planInfo[p]!
                return (
                  <div
                    key={p}
                    className="flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-[#1E293B] capitalize">
                        {info.label}
                      </p>
                      <p className="text-xs text-[#9CA3AF]">{info.price}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push('/dashboard/billing')}
                      className="text-[#E8501A] hover:text-[#C73D12] hover:bg-[#FFF7ED] text-xs"
                    >
                      Upgrade
                    </Button>
                  </div>
                )
              })}
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200 p-0 overflow-hidden">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-red-500" />
            <CardTitle className="text-base font-semibold text-red-600">
              Danger Zone
            </CardTitle>
          </div>
          <CardDescription>
            Irreversible and destructive actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-red-50 border border-red-200">
            <div>
              <h3 className="text-sm font-semibold text-red-700">
                Delete Account
              </h3>
              <p className="text-xs text-red-500/80 mt-0.5">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="bg-red-600 hover:bg-red-700 text-white shrink-0"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete Account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete
                    your account and remove all your data from our servers,
                    including domains, websites, CRM contacts, and AI agent
                    history.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      if (!token) return
                      setDeletingAccount(true)
                      try {
                        const res = await fetch('/api/user/profile', {
                          method: 'DELETE',
                          headers: { Authorization: `Bearer ${token}` },
                        })
                        if (res.ok) {
                          toast({
                            title: 'Account deleted',
                            description: 'Your account has been permanently deleted.',
                          })
                          logout()
                          router.push('/')
                        } else {
                          const data = await res.json().catch(() => ({}))
                          toast({
                            title: 'Error',
                            description: data.error?.message || data.error || 'Failed to delete account.',
                            variant: 'destructive',
                          })
                        }
                      } catch {
                        toast({
                          title: 'Error',
                          description: 'Something went wrong.',
                          variant: 'destructive',
                        })
                      } finally {
                        setDeletingAccount(false)
                      }
                    }}
                    disabled={deletingAccount}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {deletingAccount ? 'Deleting...' : 'Yes, delete my account'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}