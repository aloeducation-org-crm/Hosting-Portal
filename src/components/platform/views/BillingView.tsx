'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Check, Crown, Download, AlertCircle, Sparkles, CreditCard, Receipt, Package } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

function buildAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

interface Plan {
  id: string
  name: string
  price: number
  originalPrice: number
  savePercent: number
  billing: string
  features: string[]
  popular: boolean
}

interface Subscription {
  id: string
  plan: string
  status: string
  amount: number
  startDate: string
  endDate: string | null
}

interface Invoice {
  id: string
  amount: number
  currency: string
  status: string
  dueDate: string | null
  paidAt: string | null
  createdAt: string
}

interface Order {
  id: string
  items: Array<{ type: string; name: string; price: number; qty: number }>
  total: number
  currency: string
  status: string
  createdAt: string
}

const PLAN_FEATURES = [
  { label: 'Websites', starter: '1', premium: '100', business: 'Unlimited' },
  { label: 'Domains', starter: '1', premium: '10', business: 'Unlimited' },
  { label: 'Databases', starter: '0', premium: '5', business: 'Unlimited' },
  { label: 'Apps', starter: '0', premium: '3', business: 'Unlimited' },
  { label: 'SSD Storage', starter: '10 GB', premium: '100 GB', business: '500 GB' },
  { label: 'Bandwidth', starter: '100 GB', premium: 'Unlimited', business: 'Unlimited' },
  { label: 'SSL Certificate', starter: true, premium: true, business: true },
  { label: 'Backups', starter: 'Weekly', premium: 'Daily', business: 'Real-time' },
  { label: 'Support', starter: 'Standard', premium: 'Priority', business: 'Dedicated' },
]

export default function BillingView() {
  const [activeTab, setActiveTab] = useState('plans')
  const [plans, setPlans] = useState<Plan[]>([])
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [upgrading, setUpgrading] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (activeTab === 'plans') {
          const [plansRes, subRes] = await Promise.all([
            fetch('/api/pricing/plans', { credentials: 'same-origin' }),
            fetch('/api/subscriptions', { credentials: 'same-origin', headers: buildAuthHeaders() }),
          ])
          if (!cancelled) {
            if (plansRes.ok) {
              const plansData = await plansRes.json()
              setPlans(plansData.plans || plansData.data?.plans || [])
            } else throw new Error('Failed to fetch plans')
            if (subRes.status === 404) {
              setSubscription(null)
            } else if (subRes.ok) {
              const subData = await subRes.json()
              const rows = Array.isArray(subData) ? subData : subData.subscriptions || subData.data || []
              setSubscription(subData.subscription || rows[0] || null)
            }
          }
        } else if (activeTab === 'invoices') {
          const res = await fetch('/api/invoices', { credentials: 'same-origin', headers: buildAuthHeaders() })
          if (!res.ok) throw new Error('Failed to fetch invoices')
          const data = await res.json()
          if (!cancelled) setInvoices(Array.isArray(data) ? data : data.invoices || data.data || [])
        } else {
          const res = await fetch('/api/orders', { credentials: 'same-origin', headers: buildAuthHeaders() })
          if (!res.ok) throw new Error('Failed to fetch orders')
          const data = await res.json()
          if (!cancelled) setOrders(Array.isArray(data) ? data : data.orders || data.data || [])
        }
        if (!cancelled) {
          setError(null)
          setLoading(false)
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

  const handleUpgrade = async (planId: string, _price: number) => {
    setUpgrading(planId)
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({
          planId,
          billingCycle: 'monthly',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.message || 'Failed to process upgrade')
      if (body?.data?.subscription) {
        setSubscription(body.data.subscription)
      }
      toast.success(`Successfully activated ${planId} plan!`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upgrade failed. Please try again.')
    } finally {
      setUpgrading(null)
    }
  }

  const handleDownloadInvoice = (inv: Invoice) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ALO Labs Invoice ${inv.id.slice(0, 8).toUpperCase()}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; color: #1E293B; }
    .header { border-bottom: 2px solid #E8501A; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { margin: 0; font-size: 24px; color: #E8501A; }
    .header p { margin: 4px 0 0; color: #64748B; font-size: 14px; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .row .label { color: #64748B; }
    .row .value { font-weight: 600; }
    .amount { font-size: 32px; font-weight: 700; color: #1E293B; text-align: right; margin: 24px 0; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 500; }
    .status.paid { background: #dcfce7; color: #166534; }
    .status.pending { background: #fef9c3; color: #854d0e; }
    .status.overdue { background: #fee2e2; color: #991b1b; }
    .status.failed, .status.refunded { background: #fee2e2; color: #991b1b; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ALO Labs</h1>
    <p>Invoice</p>
  </div>
  <div class="row"><span class="label">Invoice #</span><span class="value">${inv.id.slice(0, 8).toUpperCase()}</span></div>
  <div class="row"><span class="label">Status</span><span class="value"><span class="status ${inv.status}">${inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</span></span></div>
  <div class="row"><span class="label">Date Issued</span><span class="value">${inv.createdAt}</span></div>
  ${inv.dueDate ? `<div class="row"><span class="label">Due Date</span><span class="value">${inv.dueDate}</span></div>` : ''}
  ${inv.paidAt ? `<div class="row"><span class="label">Paid On</span><span class="value">${inv.paidAt}</span></div>` : ''}
  <div class="amount">$${inv.amount.toFixed(2)} ${inv.currency.toUpperCase()}</div>
  <div class="footer">Thank you for your business! &mdash; ALO Labs</div>
</body>
</html>`
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `invoice-${inv.id.slice(0, 8).toUpperCase()}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'paid':
      case 'completed':
        return 'bg-green-100 text-green-700'
      case 'pending':
        return 'bg-yellow-100 text-yellow-700'
      case 'overdue':
        return 'bg-red-100 text-red-700'
      case 'failed':
      case 'refunded':
        return 'bg-red-100 text-red-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  return (
    <div className="p-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="plans" className="gap-1.5"><CreditCard className="h-3.5 w-3.5" /> Plans</TabsTrigger>
          <TabsTrigger value="invoices" className="gap-1.5"><Receipt className="h-3.5 w-3.5" /> Invoices</TabsTrigger>
          <TabsTrigger value="orders" className="gap-1.5"><Package className="h-3.5 w-3.5" /> Orders</TabsTrigger>
        </TabsList>

        {/* Plans Tab */}
        <TabsContent value="plans">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-[520px] rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
                <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); (async () => { try { const res = await fetch('/api/pricing/plans'); if (!res.ok) throw new Error(); const d = await res.json(); setPlans(d.plans || []); setError(null) } catch { setError('Failed to fetch plans') } finally { setLoading(false) } })() }} className="ml-auto">Retry</Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Current Plan Banner */}
              {subscription && (
                <Card className="mb-6 border-[#E8501A]/20 bg-gradient-to-r from-[#E8501A]/5 to-transparent">
                  <CardContent className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8501A]/10">
                        <Crown className="h-6 w-6 text-[#E8501A]" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">
                          Current Plan: <span className="text-[#E8501A] capitalize">{subscription.plan}</span>
                        </h3>
                        <p className="text-sm text-gray-500">
                          ${subscription.amount}/mo
                          {subscription.endDate && ` · Renews ${format(new Date(subscription.endDate), 'MMM d, yyyy')}`}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-green-100 text-green-700 capitalize">{subscription.status}</Badge>
                  </CardContent>
                </Card>
              )}

              {/* Plan Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {plans.map((plan) => {
                  const isCurrent = subscription?.plan === plan.id
                  return (
                    <Card
                      key={plan.id}
                      className={`relative flex flex-col ${
                        plan.popular
                          ? 'border-2 border-[#E8501A] shadow-lg shadow-[#E8501A]/10'
                          : isCurrent
                          ? 'border-[#E8501A]/40'
                          : ''
                      }`}
                    >
                      {plan.popular && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                          <Badge className="bg-[#E8501A] text-white px-3 py-1 shadow-md">
                            <Sparkles className="h-3 w-3 mr-1" />
                            MOST POPULAR
                          </Badge>
                        </div>
                      )}
                      <CardHeader className="text-center pb-2 pt-8">
                        <CardTitle className="text-xl">{plan.name}</CardTitle>
                        <div className="mt-4">
                          <span className="text-4xl font-bold">${plan.price}</span>
                          <span className="text-gray-400">/mo</span>
                        </div>
                        <p className="text-sm text-gray-400 mt-1">
                          <span className="line-through">${plan.originalPrice}/mo</span>
                          <span className="ml-2 text-green-600 font-medium">Save {plan.savePercent}%</span>
                        </p>
                        <p className="text-xs text-gray-400 mt-1">{plan.billing}</p>
                      </CardHeader>
                      <CardContent className="flex-1 flex flex-col">
                        <ul className="flex-1 space-y-3">
                          {PLAN_FEATURES.map((feat) => {
                            const val = feat[plan.id as keyof typeof feat]
                            const included = val === true || (typeof val === 'string' && val !== '0')
                            return (
                              <li key={feat.label} className="flex items-center gap-2 text-sm">
                                <Check className={`h-4 w-4 shrink-0 ${included ? 'text-green-500' : 'text-gray-300'}`} />
                                <span className={included ? 'text-gray-700' : 'text-gray-400'}>
                                  {feat.label}
                                  {typeof val === 'string' && val !== '' && (
                                    <span className="ml-1 font-medium text-gray-900">({val})</span>
                                  )}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                        <Button
                          className={plan.popular && !isCurrent ? 'w-full mt-6 bg-[#E8501A] hover:bg-[#5B2FC9]' : 'w-full mt-6'}
                          variant={isCurrent ? 'outline' : plan.popular ? 'default' : 'outline'}
                          disabled={isCurrent || upgrading === plan.id}
                          onClick={() => !isCurrent && handleUpgrade(plan.id, plan.price)}
                        >
                          {upgrading === plan.id ? 'Processing...' : isCurrent ? 'Current Plan' : 'Upgrade'}
                        </Button>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </>
          )}
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices">
          {loading ? (
            <Card>
              <CardContent className="p-0">
                {[...Array(5)].map((_, i) => (
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
          ) : invoices.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Receipt className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No invoices</h3>
                <p className="text-sm text-gray-400 mt-1">Your invoices will appear here once you have an active subscription</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Paid Date</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-sm">{inv.id.slice(0, 8).toUpperCase()}</TableCell>
                        <TableCell className="font-medium">${inv.amount.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusColor(inv.status)}>
                            {inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-500 text-sm">
                          {inv.dueDate ? format(new Date(inv.dueDate), 'MMM d, yyyy') : '-'}
                        </TableCell>
                        <TableCell className="text-gray-500 text-sm">
                          {inv.paidAt ? format(new Date(inv.paidAt), 'MMM d, yyyy') : '-'}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownloadInvoice(inv)}>
                            <Download className="h-4 w-4 text-gray-400" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Orders Tab */}
        <TabsContent value="orders">
          {loading ? (
            <Card>
              <CardContent className="p-0">
                {[...Array(5)].map((_, i) => (
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
          ) : orders.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Package className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No orders</h3>
                <p className="text-sm text-gray-400 mt-1">Your order history will appear here</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-sm">{order.id.slice(0, 8).toUpperCase()}</TableCell>
                        <TableCell className="max-w-xs">
                          <div className="flex flex-wrap gap-1">
                            {order.items.map((item, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {item.name}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">${order.total.toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusColor(order.status)}>
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-500 text-sm">
                          {format(new Date(order.createdAt), 'MMM d, yyyy')}
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
    </div>
  )
}