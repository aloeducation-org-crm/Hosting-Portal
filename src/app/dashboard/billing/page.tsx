'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
  CreditCard,
  Globe,
  Monitor,
  Mail,
  Calendar,
  Download,
  ArrowRight,
  Crown,
  FileText,
  ExternalLink,
} from 'lucide-react'

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface PlanInfo {
  id: string
  name: string
  price: number
  domains: number
  websites: number
  emails: number
}

interface UsageStats {
  domainsUsed: number
  websitesUsed: number
  emailsUsed: number
}

interface OrderItem {
  type: string
  name: string
  price: number
  qty: number
}

interface Order {
  id: string
  items: OrderItem[]
  total: number
  currency: string
  status: string
  paymentMethod: string | null
  createdAt: string
  invoices: { id: string; amount: number; status: string; dueDate: string | null }[]
}

interface Invoice {
  id: string
  orderId: string | null
  amount: number
  currency: string
  status: string
  dueDate: string | null
  paidAt: string | null
  createdAt: string
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const PLAN_INFO: Record<string, PlanInfo> = {
  free: { id: 'free', name: 'Free', price: 0, domains: 0, websites: 0, emails: 0 },
  starter: { id: 'starter', name: 'Starter', price: 2.99, domains: 1, websites: 1, emails: 100 },
  premium: { id: 'premium', name: 'Premium', price: 3.99, domains: 100, websites: 100, emails: 1000 },
  business: { id: 'business', name: 'Business', price: 7.99, domains: 100, websites: 100, emails: 1000 },
}

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700 border-gray-200',
  starter: 'bg-blue-50 text-blue-700 border-blue-200',
  premium: 'bg-amber-50 text-amber-700 border-amber-200',
  business: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

const ORDER_STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-600',
}

const INVOICE_STATUS_STYLES: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/* ─── Usage Bar ──────────────────────────────────────────────────────────── */

function UsageBar({
  icon: Icon,
  label,
  used,
  limit,
  color,
}: {
  icon: typeof Globe
  label: string
  used: number
  limit: number
  color: string
}) {
  const isUnlimited = limit <= 0
  const pct = isUnlimited ? 0 : Math.min((used / limit) * 100, 100)

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-[#1E293B]">{label}</span>
          <span className="text-xs text-[#475569]">
            {used} / {isUnlimited ? '∞' : limit}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-[#E2E8F0] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              backgroundColor: color,
            }}
          />
        </div>
      </div>
    </div>
  )
}

/* ─── Main Component ─────────────────────────────────────────────────────── */

export default function BillingPage() {
  const { user, token } = useAuthStore()
  const [activeTab, setActiveTab] = useState('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [availablePlans, setAvailablePlans] = useState<Array<{
    id: string
    name: string
    slug: string
    description: string | null
    price: number
    interval: string
    websites: number
    storage: number
    databases: number
    emailAccounts: number
    aiCredits: number
    popular?: boolean
  }>>([])
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgradingPlanId, setUpgradingPlanId] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageStats>({
    domainsUsed: 0,
    websitesUsed: 0,
    emailsUsed: 0,
  })
  const [subscription, setSubscription] = useState<{
    plan: string
    planName?: string
    status: string
    endDate: string | null
    amount: number
    websitesLimit?: number
    emailsLimit?: number
  } | null>(null)
  const [loading, setLoading] = useState(true)

  const loadBillingData = useCallback(async () => {
    try {
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

      const [ordersRes, invoicesRes, statsRes, subsRes, plansRes] = await Promise.all([
        fetch('/api/orders', { headers, credentials: 'same-origin' }),
        fetch('/api/invoices', { headers, credentials: 'same-origin' }),
        fetch('/api/dashboard/stats', { headers, credentials: 'same-origin' }),
        fetch('/api/subscriptions', { headers, credentials: 'same-origin' }),
        fetch('/api/pricing/plans', { credentials: 'same-origin' }),
      ])

      let parsedOrders: Order[] = []
      if (ordersRes.ok) {
        const data = await ordersRes.json()
        parsedOrders = data.orders || data.data || []
        setOrders(Array.isArray(parsedOrders) ? parsedOrders : [])
      }

      if (invoicesRes.ok) {
        const data = await invoicesRes.json()
        const rawInv = data.invoices || data.data || []
        setInvoices(
          Array.isArray(rawInv)
            ? rawInv.map((inv: Record<string, unknown>) => ({
                id: String(inv.id),
                orderId: (inv.orderId as string | null) ?? null,
                amount:
                  typeof inv.amount === 'number'
                    ? inv.amount
                    : typeof inv.amountCents === 'number'
                      ? inv.amountCents / 100
                      : 0,
                currency: String(inv.currency || 'USD'),
                status: String(inv.status || 'pending'),
                dueDate: (inv.dueDate as string | null) ?? null,
                paidAt: (inv.paidAt as string | null) ?? null,
                createdAt: String(inv.createdAt || new Date().toISOString()),
              }))
            : [],
        )
      }

      if (statsRes.ok) {
        const data = await statsRes.json()
        const s = data.stats || data.data || {}
        setUsage({
          domainsUsed: Number(s.domains ?? 0),
          websitesUsed: Number(s.activeWebsites ?? s.websites ?? 0),
          emailsUsed: Number(s.emailAccounts ?? 0),
        })
      }

      if (plansRes.ok) {
        const pData = await plansRes.json()
        const list = pData.plans || pData.data || []
        if (Array.isArray(list)) setAvailablePlans(list)
      }

      if (subsRes.ok) {
        const sData = await subsRes.json()
        const subs = sData.data || sData.subscriptions || []
        const activeSub = Array.isArray(subs)
          ? subs.find((item: Record<string, unknown>) => item.status === 'active')
          : null
        if (activeSub && activeSub.plan) {
          setSubscription({
            plan: activeSub.plan.slug?.includes('business')
              ? 'business'
              : activeSub.plan.slug?.includes('enterprise')
                ? 'premium'
                : 'starter',
            planName: activeSub.plan.name,
            status: activeSub.status,
            endDate: activeSub.currentPeriodEnd || null,
            amount: Number(activeSub.plan.price ?? 0),
            websitesLimit: Number(activeSub.plan.websites ?? 10),
            emailsLimit: Number(activeSub.plan.emailAccounts ?? 25),
          })
          return
        }
      }

      const planOrder = parsedOrders.find((o: Order) =>
        Array.isArray(o.items) &&
        o.items.some((item: OrderItem) => ['starter', 'premium', 'business'].includes(item.type)),
      )
      if (planOrder) {
        const planItem = planOrder.items.find((item: OrderItem) =>
          ['starter', 'premium', 'business'].includes(item.type),
        )
        if (planItem) {
          const end = new Date(planOrder.createdAt)
          end.setFullYear(end.getFullYear() + 1)
          setSubscription({
            plan: planItem.type,
            status: 'active',
            endDate: end.toISOString(),
            amount: planItem.price,
          })
        }
      }
    } catch (err) {
      console.error('Failed to fetch billing data:', err)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    let active = true
    ;(async () => {
      if (active) await loadBillingData()
    })()
    return () => {
      active = false
    }
  }, [loadBillingData])

  const handleActivatePlan = async (planId: string) => {
    setUpgradingPlanId(planId)
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ planId }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        throw new Error(body?.message || 'Failed to activate hosting plan')
      }
      toast.success(body.message || 'Hosting plan activated successfully!')
      setUpgradeOpen(false)
      await loadBillingData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to activate hosting plan')
    } finally {
      setUpgradingPlanId(null)
    }
  }

  const plan = subscription?.plan || user?.plan || 'free'
  const basePlanInfo = (PLAN_INFO[plan] || PLAN_INFO.free)!
  const planInfo: PlanInfo = {
    ...basePlanInfo,
    name: subscription?.planName || basePlanInfo.name,
    price: subscription ? subscription.amount : basePlanInfo.price,
    websites: subscription?.websitesLimit ?? basePlanInfo.websites,
    emails: subscription?.emailsLimit ?? basePlanInfo.emails,
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1E293B]">Billing & Invoices</h1>
        <p className="text-[#475569] mt-1">
          Manage your subscription, view orders, and download invoices.
        </p>
      </div>

      {/* Current Plan + Usage Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Current Plan Card */}
        <Card className="border-[#E2E8F0] p-0 overflow-hidden lg:col-span-1">
          <CardHeader className="pb-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-[#1E293B]">
                Current Plan
              </CardTitle>
              <Crown className="h-5 w-5 text-[#E8501A]" />
            </div>
          </CardHeader>
          <CardContent className="pt-2 space-y-4">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold text-[#1E293B]">
                    {planInfo.name}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs font-semibold px-2.5 py-1 capitalize',
                      PLAN_COLORS[plan] || PLAN_COLORS.free
                    )}
                  >
                    {plan === 'free' ? 'Free' : 'Active'}
                  </Badge>
                </div>

                {plan !== 'free' && (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#475569]">Monthly price</span>
                      <span className="font-medium text-[#1E293B]">
                        {formatCurrency(planInfo.price)}/mo
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#475569]">Renewal date</span>
                      <span className="font-medium text-[#1E293B]">
                        {subscription?.endDate
                          ? formatDate(subscription.endDate)
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#475569]">Billing cycle</span>
                      <span className="font-medium text-[#1E293B]">Annual</span>
                    </div>
                  </div>
                )}

                {plan === 'free' && (
                  <p className="text-sm text-[#475569]">
                    You&apos;re on the free plan. Upgrade to unlock more features.
                  </p>
                )}

                <Button
                  type="button"
                  onClick={() => setUpgradeOpen(true)}
                  className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white font-semibold"
                >
                  {plan === 'free' ? 'Upgrade Plan' : 'Change Plan'}
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Usage Stats Card */}
        <Card className="border-[#E2E8F0] p-0 overflow-hidden lg:col-span-2">
          <CardHeader className="pb-0">
            <CardTitle className="text-base font-semibold text-[#1E293B]">
              Usage
            </CardTitle>
            <CardDescription className="text-[#475569]">
              Your current resource usage this billing period
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {loading ? (
              <div className="space-y-4 py-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-9 w-9 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-1.5 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5 py-2">
                <UsageBar
                  icon={Globe}
                  label="Domains"
                  used={usage.domainsUsed}
                  limit={planInfo.domains}
                  color="#E8501A"
                />
                <UsageBar
                  icon={Monitor}
                  label="Websites"
                  used={usage.websitesUsed}
                  limit={planInfo.websites}
                  color="#059669"
                />
                <UsageBar
                  icon={Mail}
                  label="Email Accounts"
                  used={usage.emailsUsed}
                  limit={planInfo.emails}
                  color="#D97706"
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Orders & Invoices Tabs */}
      <Card className="border-[#E2E8F0] p-0 overflow-hidden">
        <CardContent className="p-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="border-b border-[#E2E8F0] px-6 pt-4">
              <TabsList className="bg-transparent h-auto p-0 gap-6 border-b-0">
                <TabsTrigger
                  value="orders"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#E8501A] data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[#475569] data-[state=active]:text-[#E8501A] pb-3 px-0 text-sm font-medium transition-colors"
                >
                  <CreditCard className="h-4 w-4 mr-1.5" />
                  Order History
                  {orders.length > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-[#E8501A]/10 text-[10px] font-semibold text-[#E8501A]">
                      {orders.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="invoices"
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#E8501A] data-[state=active]:bg-transparent data-[state=active]:shadow-none text-[#475569] data-[state=active]:text-[#E8501A] pb-3 px-0 text-sm font-medium transition-colors"
                >
                  <FileText className="h-4 w-4 mr-1.5" />
                  Invoices
                  {invoices.length > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-[#E8501A]/10 text-[10px] font-semibold text-[#E8501A]">
                      {invoices.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Orders Tab ─────────────────────────────────────────── */}
            <TabsContent value="orders" className="p-6 pt-4 m-0">
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF7ED] mb-4">
                    <CreditCard className="h-7 w-7 text-[#E8501A]" />
                  </div>
                  <p className="text-sm font-semibold text-[#1E293B]">
                    No orders yet
                  </p>
                  <p className="text-xs text-[#475569] mt-1">
                    Your order history will appear here after your first purchase.
                  </p>
                  <Button
                    type="button"
                    onClick={() => setUpgradeOpen(true)}
                    className="mt-4 bg-[#E8501A] hover:bg-[#C73D12] text-white"
                    size="sm"
                  >
                    View Plans
                  </Button>
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b-[#E2E8F0]">
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider">
                          Date
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider">
                          Items
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider text-right">
                          Total
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider text-center">
                          Status
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider text-right">
                          Invoice
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order) => (
                        <TableRow
                          key={order.id}
                          className="border-b-[#E2E8F0]/60"
                        >
                          <TableCell className="text-sm text-[#1E293B]">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3.5 w-3.5 text-[#9CA3AF]" />
                              {formatDate(order.createdAt)}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-[#1E293B]">
                            {order.items.map((item) => item.name).join(', ')}
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-[#1E293B] text-right">
                            {formatCurrency(order.total)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-xs font-semibold capitalize',
                                ORDER_STATUS_STYLES[order.status] || 'bg-gray-100 text-gray-600'
                              )}
                            >
                              {order.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {order.invoices.length > 0 ? (
                              <Button
                                asChild
                                variant="ghost"
                                size="sm"
                                className="text-[#E8501A] hover:text-[#C73D12] hover:bg-[#FFF7ED] text-xs font-medium"
                              >
                                <Link
                                  href={`/api/invoices/${order.invoices?.[0]?.id}`}
                                  target="_blank"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                  View
                                </Link>
                              </Button>
                            ) : (
                              <span className="text-xs text-[#9CA3AF]">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            {/* ── Invoices Tab ────────────────────────────────────────── */}
            <TabsContent value="invoices" className="p-6 pt-4 m-0">
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : invoices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF7ED] mb-4">
                    <FileText className="h-7 w-7 text-[#E8501A]" />
                  </div>
                  <p className="text-sm font-semibold text-[#1E293B]">
                    No invoices yet
                  </p>
                  <p className="text-xs text-[#475569] mt-1">
                    Invoices are generated automatically with each order.
                  </p>
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b-[#E2E8F0]">
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider">
                          Invoice #
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider text-right">
                          Amount
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider text-center">
                          Status
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider">
                          Due Date
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-[#475569] uppercase tracking-wider text-right">
                          Download
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((invoice) => (
                        <TableRow
                          key={invoice.id}
                          className="border-b-[#E2E8F0]/60"
                        >
                          <TableCell className="text-sm text-[#1E293B] font-mono">
                            {invoice.id.slice(0, 8).toUpperCase()}
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-[#1E293B] text-right">
                            {formatCurrency(invoice.amount)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-xs font-semibold capitalize',
                                INVOICE_STATUS_STYLES[invoice.status] || 'bg-gray-100 text-gray-600'
                              )}
                            >
                              {invoice.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-[#1E293B]">
                            {invoice.dueDate ? formatDate(invoice.dueDate) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              asChild
                              variant="ghost"
                              size="sm"
                              className="text-[#E8501A] hover:text-[#C73D12] hover:bg-[#FFF7ED] text-xs font-medium"
                            >
                              <Link
                                href={`/api/invoices/${invoice.id}`}
                                target="_blank"
                              >
                                <Download className="h-3.5 w-3.5 mr-1" />
                                Download
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Interactive Plan Upgrade / Switch Modal */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select Your Hosting & AI Automation Plan</DialogTitle>
            <DialogDescription>
              Instant activation with automated invoice & quota provisioning on alo-server-lap.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
            {availablePlans.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'rounded-xl border p-4 flex flex-col justify-between gap-3',
                  p.popular ? 'border-[#E8501A] bg-[#FFF7ED]/50' : 'border-slate-200',
                )}
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-sm text-[#1E293B]">{p.name}</span>
                    {p.popular && (
                      <Badge className="bg-[#E8501A] text-white text-[10px]">Popular</Badge>
                    )}
                  </div>
                  <div className="text-xl font-bold text-[#1E293B]">
                    ${p.price.toFixed(2)}
                    <span className="text-xs font-normal text-[#475569]">/{p.interval}</span>
                  </div>
                  <p className="text-xs text-[#475569]">{p.description}</p>
                  <ul className="text-xs text-[#334155] space-y-1 pt-1">
                    <li>• {p.websites} Managed Apps / Websites</li>
                    <li>• {p.storage} GB NVMe Storage</li>
                    <li>• {p.databases} Databases · {p.emailAccounts} Emails</li>
                    <li>• {p.aiCredits.toLocaleString()} AI Automation Credits</li>
                  </ul>
                </div>
                <Button
                  type="button"
                  disabled={upgradingPlanId !== null}
                  onClick={() => void handleActivatePlan(p.id)}
                  className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white text-xs"
                  size="sm"
                >
                  {upgradingPlanId === p.id ? 'Activating...' : `Activate ${p.name}`}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}