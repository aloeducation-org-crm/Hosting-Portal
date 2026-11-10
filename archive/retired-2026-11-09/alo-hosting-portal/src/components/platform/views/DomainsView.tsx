'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Globe,
  Search,
  Plus,
  AlertCircle,
  ShoppingCart,
  ShieldCheck,
  Calendar,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

interface Domain {
  id: string
  name: string
  tld: string
  status: string
  purchaseDate: string
  expiryDate: string | null
  autoRenew: boolean
  locked: boolean
  createdAt: string
  updatedAt: string
}

interface SearchDomain {
  name: string
  available: boolean
  price: number
  tld: string
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  expired: { label: 'Expired', className: 'bg-red-50 text-red-700 border-red-200' },
  transferred: { label: 'Transferred', className: 'bg-purple-50 text-purple-700 border-purple-200' },
  pending: { label: 'Pending', className: 'bg-amber-50 text-amber-700 border-amber-200' },
}

export default function DomainsView() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null

  const [domains, setDomains] = useState<Domain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchDomain[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  const [purchaseTarget, setPurchaseTarget] = useState<SearchDomain | null>(null)
  const [purchasing, setPurchasing] = useState(false)

  const loadDomains = async () => {
    if (!token) return
    try {
      const res = await fetch('/api/domains/mine', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch domains')
      const data = await res.json()
      setDomains(data.domains || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) return
      try {
        const res = await fetch('/api/domains/mine', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch domains')
        const data = await res.json()
        if (!cancelled) {
          setDomains(data.domains || [])
          setError(null)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Something went wrong')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleSearch = async () => {
    if (!searchQuery.trim() || !token) return
    try {
      setSearching(true)
      setHasSearched(true)
      const res = await fetch('/api/domains/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: searchQuery.trim() }),
      })
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      setSearchResults(data.domains || [])
    } catch (err) {
      toast.error('Domain search failed')
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const handlePurchase = async () => {
    if (!purchaseTarget || !token) return
    try {
      setPurchasing(true)
      const res = await fetch('/api/domains/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: purchaseTarget.name,
          tld: purchaseTarget.tld,
          price: purchaseTarget.price,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to purchase domain')
      }
      toast.success(`Domain "${purchaseTarget.name}" purchased successfully!`)
      setPurchaseTarget(null)
      setSearchResults([])
      setHasSearched(false)
      setSearchQuery('')
      loadDomains()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to purchase domain')
    } finally {
      setPurchasing(false)
    }
  }

  const handleToggleAutoRenew = async (domain: Domain) => {
    if (!token) return
    try {
      const res = await fetch(`/api/domains/${domain.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ autoRenew: !domain.autoRenew }),
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success(`Auto-renew ${!domain.autoRenew ? 'enabled' : 'disabled'}`)
      loadDomains()
    } catch {
      toast.error('Failed to update domain')
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Failed to load domains</h3>
            <p className="text-sm text-gray-500 mb-4">{error}</p>
            <Button
              variant="outline"
              onClick={loadDomains}
              className="border-[#E8501A] text-[#E8501A] hover:bg-[#E8501A] hover:text-white"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Domains</h1>
        <p className="text-sm text-gray-500 mt-1">Search, register, and manage your domain names</p>
      </div>

      {/* Search Bar */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search for a domain name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="pl-10"
              />
            </div>
            <Button
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white gap-2"
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search Results */}
      {hasSearched && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Search className="h-4 w-4 text-[#E8501A]" />
              Search Results
              <Badge variant="secondary" className="ml-1">
                {searchResults.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {searching ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-8 w-24 rounded-md" />
                  </div>
                ))}
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-8">
                <Globe className="h-8 w-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No domains found for &ldquo;{searchQuery}&rdquo;</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {searchResults.map((domain) => (
                  <div
                    key={domain.name}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {domain.available ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-400 shrink-0" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">{domain.name}</p>
                        <p className="text-xs text-gray-400">
                          {domain.available ? 'Available' : 'Taken'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-900">
                        ${domain.price.toFixed(2)}/yr
                      </span>
                      <Button
                        size="sm"
                        className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white h-8"
                        disabled={!domain.available}
                        onClick={() => setPurchaseTarget(domain)}
                      >
                        <ShoppingCart className="h-3.5 w-3.5 mr-1" />
                        Register
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* My Domains */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#E8501A]" />
            My Domains
            <Badge variant="secondary" className="ml-1">
              {domains.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <div className="text-center py-12">
              <div className="h-16 w-16 rounded-2xl bg-[#E8501A]/10 flex items-center justify-center mx-auto mb-4">
                <Globe className="h-8 w-8 text-[#E8501A]" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No domains yet</h3>
              <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
                Search for a domain name above and register it to get started.
              </p>
              <Button
                className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white gap-2"
                onClick={() => document.querySelector('input')?.focus()}
              >
                <Plus className="h-4 w-4" />
                Find a Domain
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Domain</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">TLD</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Expiry</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Auto-Renew</TableHead>
                    <TableHead className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Registered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((domain) => {
                    const statusConf = (STATUS_CONFIG[domain.status] || STATUS_CONFIG.pending)!
                    const isExpiringSoon =
                      domain.expiryDate &&
                      new Date(domain.expiryDate) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) &&
                      domain.status === 'active'

                    return (
                      <TableRow key={domain.id} className="hover:bg-gray-50/80">
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-lg bg-[#E8501A]/10 flex items-center justify-center">
                              <Globe className="h-4 w-4 text-[#E8501A]" />
                            </div>
                            <span className="font-medium text-gray-900 text-sm">{domain.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
                            {domain.tld}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusConf.className}>
                            {statusConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-gray-400" />
                            {domain.expiryDate ? (
                              <span className={`text-sm ${isExpiringSoon ? 'text-amber-600 font-medium' : 'text-gray-600'}`}>
                                {format(new Date(domain.expiryDate), 'MMM d, yyyy')}
                                {isExpiringSoon && (
                                  <span className="ml-1.5 text-xs text-amber-500">(soon)</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center">
                            <Switch
                              checked={domain.autoRenew}
                              onCheckedChange={() => handleToggleAutoRenew(domain)}
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-500">
                            {format(new Date(domain.purchaseDate), 'MMM d, yyyy')}
                          </span>
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

      {/* Purchase Confirmation Dialog */}
      <Dialog open={!!purchaseTarget} onOpenChange={(open) => !open && setPurchaseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Domain Purchase</DialogTitle>
            <DialogDescription>
              You are about to register the following domain name.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4 rounded-lg bg-[#E8501A]/5 border border-[#E8501A]/10">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[#E8501A]/10 flex items-center justify-center">
                <Globe className="h-5 w-5 text-[#E8501A]" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{purchaseTarget?.name}</p>
                <p className="text-sm text-gray-500">1 year registration</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-gray-500">Total Price</span>
            <span className="text-lg font-bold text-gray-900">${purchaseTarget?.price.toFixed(2)}</span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseTarget(null)} disabled={purchasing}>
              Cancel
            </Button>
            <Button
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              onClick={handlePurchase}
              disabled={purchasing}
            >
              {purchasing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ShieldCheck className="h-4 w-4 mr-2" />
              )}
              Purchase Domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}