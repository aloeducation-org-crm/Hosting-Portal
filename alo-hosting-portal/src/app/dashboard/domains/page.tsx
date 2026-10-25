'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Search,
  Globe,
  CheckCircle2,
  XCircle,
  ShoppingCart,
  Settings,
  Lock,
  Unlock,
  Clock,
  AlertTriangle,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
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
}

interface SearchResult {
  name: string
  available: boolean
  price: number
  tld: string
}

interface Stats {
  total: number
  active: number
  expiringSoon: number
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    expired: 'bg-red-50 text-red-700 border-red-200',
    transferred: 'bg-blue-50 text-blue-700 border-blue-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
  }
  return (
    <Badge variant="outline" className={styles[status] || 'bg-gray-50 text-gray-700 border-gray-200'}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}

export default function DomainsPage() {
  const token = useAuthStore((s) => s.token)
  const router = useRouter()

  const [domains, setDomains] = useState<Domain[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, expiringSoon: 0 })
  const [loading, setLoading] = useState(true)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // Purchasing state
  const [purchasing, setPurchasing] = useState<string | null>(null)

  // Auto-renew toggle state
  const [togglingRenew, setTogglingRenew] = useState<string | null>(null)

  const refreshDomains = async () => {
    if (!token) return
    try {
      const res = await fetch('/api/domains/mine', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setDomains(data.domains)
        setStats(data.stats)
      }
    } catch {
      // Non-critical
    }
  }

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/domains/mine', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!cancelled && res.ok) {
          const data = await res.json()
          setDomains(data.domains)
          setStats(data.stats)
        }
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setHasSearched(true)
    try {
      const res = await fetch('/api/domains/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.domains)
      }
    } catch {
      toast.error('Search failed. Please try again.')
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const handlePurchase = useCallback(
    async (domain: SearchResult) => {
      if (!token) return
      setPurchasing(domain.name)
      try {
        const res = await fetch('/api/domains/purchase', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: domain.name,
            tld: domain.tld,
            price: domain.price,
          }),
        })
        if (res.ok) {
          toast.success(`${domain.name} registered successfully!`)
          setSearchResults((prev) => prev.map((d) => (d.name === domain.name ? { ...d, available: false } : d)))
          refreshDomains()
        } else {
          const data = await res.json()
          toast.error(data.error || 'Purchase failed')
        }
      } catch {
        toast.error('Purchase failed. Please try again.')
      } finally {
        setPurchasing(null)
      }
    },
    [token, refreshDomains]
  )

  const handleToggleAutoRenew = useCallback(
    async (domain: Domain) => {
      if (!token) return
      setTogglingRenew(domain.id)
      try {
        const res = await fetch(`/api/domains/${domain.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ autoRenew: !domain.autoRenew }),
        })
        if (res.ok) {
          setDomains((prev) =>
            prev.map((d) => (d.id === domain.id ? { ...d, autoRenew: !d.autoRenew } : d))
          )
          toast.success(`Auto-renew ${!domain.autoRenew ? 'enabled' : 'disabled'}`)
        }
      } catch {
        toast.error('Failed to update auto-renew')
      } finally {
        setTogglingRenew(null)
      }
    },
    [token]
  )

  const handleToggleLock = useCallback(
    async (domain: Domain) => {
      if (!token) return
      try {
        const res = await fetch(`/api/domains/${domain.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ locked: !domain.locked }),
        })
        if (res.ok) {
          setDomains((prev) =>
            prev.map((d) => (d.id === domain.id ? { ...d, locked: !d.locked } : d))
          )
          toast.success(`Domain ${!domain.locked ? 'locked' : 'unlocked'}`)
        }
      } catch {
        toast.error('Failed to update lock status')
      }
    },
    [token]
  )

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B]">My Domains</h1>
          <p className="text-[#475569] mt-1">
            Search, register, and manage your domain names
          </p>
        </div>
        <Badge variant="secondary" className="bg-[#FFF7ED] text-[#E8501A] border-[#E2E8F0] px-3 py-1 text-sm self-start">
          <Globe className="size-3.5 mr-1" />
          {stats.total} Domain{stats.total !== 1 ? 's' : ''}
        </Badge>
      </div>

      {/* Stats Cards */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-[#E2E8F0]">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF7ED]">
                <Globe className="h-5 w-5 text-[#E8501A]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#1E293B]">{stats.total}</p>
                <p className="text-xs text-[#475569]">Total Domains</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-[#E2E8F0]">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#1E293B]">{stats.active}</p>
                <p className="text-xs text-[#475569]">Active</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-[#E2E8F0]">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#1E293B]">{stats.expiringSoon}</p>
                <p className="text-xs text-[#475569]">Expiring Soon</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search Section */}
      <Card className="border-[#E2E8F0]">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-[#1E293B] mb-3 flex items-center gap-2">
            <Search className="h-5 w-5 text-[#E8501A]" />
            Search & Register a Domain
          </h2>
          <div className="flex gap-2">
            <Input
              placeholder="Enter a domain name (e.g., mybusiness)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1 bg-[#F9F8FC] border-[#E2E8F0] focus-visible:ring-[#E8501A]/20"
            />
            <Button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="bg-[#E8501A] hover:bg-[#C73D12] text-white shrink-0"
            >
              {searching ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Searching
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Search
                </span>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!searchQuery.trim()) return
                setSearching(true)
                setHasSearched(true)
                try {
                  const res = await fetch('/api/domains/suggestions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: searchQuery.trim() }),
                  })
                  if (res.ok) {
                    const data = await res.json()
                    setSearchResults(
                      data.suggestions.map((s: SearchResult) => ({
                        ...s,
                        tld: s.name.match(/\.[a-z]+$/)?.[0] || '.com',
                      }))
                    )
                  }
                } catch {
                  toast.error('Failed to get suggestions')
                } finally {
                  setSearching(false)
                }
              }}
              disabled={searching || !searchQuery.trim()}
              className="border-[#E2E8F0] text-[#E8501A] hover:bg-[#FFF7ED] shrink-0"
            >
              <Sparkles className="h-4 w-4 mr-1" />
              AI
            </Button>
          </div>

          {/* Search Results */}
          {hasSearched && (
            <div className="mt-4">
              {searching ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : searchResults.length === 0 ? (
                <p className="text-sm text-[#475569] py-4 text-center">
                  No results found. Try a different search term.
                </p>
              ) : (
                <div className="grid gap-2 max-h-80 overflow-y-auto pr-1">
                  {searchResults.map((domain) => (
                    <div
                      key={domain.name}
                      className="flex items-center justify-between p-3 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F9F8FC] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {domain.available ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-400 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-[#1E293B] truncate">{domain.name}</p>
                          <p className="text-xs text-[#475569]">{domain.tld}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <span className="text-sm font-semibold text-[#1E293B]">
                          ${domain.price.toFixed(2)}/yr
                        </span>
                        {domain.available ? (
                          <Button
                            size="sm"
                            onClick={() => handlePurchase(domain)}
                            disabled={purchasing === domain.name}
                            className="bg-[#E8501A] hover:bg-[#C73D12] text-white h-8"
                          >
                            {purchasing === domain.name ? (
                              <span className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                              <span className="flex items-center gap-1">
                                <ShoppingCart className="h-3.5 w-3.5" />
                                Register
                              </span>
                            )}
                          </Button>
                        ) : (
                          <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-500">
                            Taken
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Purchased Domains Table */}
      <Card className="border-[#E2E8F0]">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold text-[#1E293B] mb-4 flex items-center gap-2">
            <Globe className="h-5 w-5 text-[#E8501A]" />
            Your Domains
          </h2>

          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : domains.length === 0 ? (
            <div className="text-center py-12">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#FFF7ED] mb-4">
                <Globe className="h-8 w-8 text-[#E8501A]" />
              </div>
              <h3 className="text-lg font-semibold text-[#1E293B] mb-1">No domains yet</h3>
              <p className="text-[#475569] text-sm max-w-md mx-auto">
                Search and register your first domain above to get started!
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-[#E2E8F0] hover:bg-transparent">
                    <TableHead className="text-[#475569] font-medium">Name</TableHead>
                    <TableHead className="text-[#475569] font-medium">TLD</TableHead>
                    <TableHead className="text-[#475569] font-medium">Status</TableHead>
                    <TableHead className="text-[#475569] font-medium hidden md:table-cell">Purchase Date</TableHead>
                    <TableHead className="text-[#475569] font-medium hidden lg:table-cell">Expiry Date</TableHead>
                    <TableHead className="text-[#475569] font-medium">Auto-Renew</TableHead>
                    <TableHead className="text-[#475569] font-medium text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((domain) => (
                    <TableRow key={domain.id} className="border-[#E2E8F0] hover:bg-[#F9F8FC]">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-[#E8501A] shrink-0" />
                          <span className="font-medium text-[#1E293B]">{domain.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-[#FFF7ED] text-[#E8501A]">
                          {domain.tld}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={domain.status} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-[#475569]">
                        {formatDate(domain.purchaseDate)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[#475569]" />
                          <span className="text-sm text-[#475569]">{formatDate(domain.expiryDate)}</span>
                          {domain.expiryDate && new Date(domain.expiryDate) <= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) && domain.status === 'active' && (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={domain.autoRenew}
                          disabled={togglingRenew === domain.id}
                          onCheckedChange={() => handleToggleAutoRenew(domain)}
                          className="data-[state=checked]:bg-[#E8501A]"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/dashboard/domains/${domain.id}`)}
                            className="text-[#E8501A] hover:bg-[#FFF7ED] h-8 px-2"
                          >
                            <Settings className="h-4 w-4" />
                            <span className="hidden sm:inline ml-1">Manage</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleLock(domain)}
                            className="text-[#475569] hover:bg-[#FFF7ED] h-8 px-2"
                            title={domain.locked ? 'Unlock domain' : 'Lock domain'}
                          >
                            {domain.locked ? (
                              <Lock className="h-4 w-4 text-amber-500" />
                            ) : (
                              <Unlock className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/dashboard/domains/${domain.id}?tab=dns`)}
                            className="text-[#475569] hover:bg-[#FFF7ED] h-8 px-2 hidden sm:flex"
                            title="Manage DNS"
                          >
                            DNS
                            <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}