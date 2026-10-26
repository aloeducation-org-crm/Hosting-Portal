'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Code2,
  Layout,
  Globe,
  Search,
  PenTool,
  Mail,
  Share2,
  Palette,
  MessageSquare,
  BarChart3,
  Shield,
  HardDrive,
  ArrowRightLeft,
  Zap,
  Languages,
  Sparkles,
  ArrowRight,
  Users,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Code2,
  Layout,
  Globe,
  Search,
  PenTool,
  Mail,
  Share2,
  Palette,
  MessageSquare,
  BarChart3,
  Shield,
  HardDrive,
  ArrowRightLeft,
  Zap,
  Languages,
}

const CATEGORIES = [
  'All',
  'Coding',
  'Design',
  'Marketing',
  'Business',
  'Security',
  'DevOps',
  'Utility',
  'Support',
]

interface Agent {
  id: string
  name: string
  slug: string
  description: string
  category: string
  icon: string
  isFree: boolean
  usageCount: number
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  if (n === 0) return 'New'
  return String(n)
}

export default function AgentsMarketplacePage() {
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const params = new URLSearchParams()
        if (activeCategory !== 'All') params.set('category', activeCategory)
        if (search.trim()) params.set('search', search.trim())

        const res = await fetch(`/api/agents?${params.toString()}`)
        const data = await res.json()
        if (!cancelled && data.success) setAgents(data.agents)
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch agents:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [activeCategory, search])

  const featuredAgent = agents.find((a) => a.slug === 'gpt5-code')
  const otherAgents = agents.filter((a) => a.slug !== 'gpt5-code')

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8501A]/10">
              <Sparkles className="h-5 w-5 text-[#E8501A]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#1E293B]">AI Agents</h1>
              <p className="text-sm text-[#475569]">
                15 built-in portal agents + hardened self-hosted container deployments
              </p>
            </div>
            <div className="ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push('/ai/self-hosted')}
                className="text-xs"
              >
                Self-Hosted AI Deploy &amp; Sizing <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Search + Filter */}
        <div className="mb-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#475569]" />
            <Input
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 pl-10"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <Button
                key={cat}
                variant={activeCategory === cat ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  'rounded-full text-xs font-medium transition-all',
                  activeCategory === cat &&
                    'bg-[#E8501A] hover:bg-[#C73D12] text-white border-[#E8501A]'
                )}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-6">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        {!loading && (
          <>
            {/* Featured GPT-5 Code Agent */}
            {featuredAgent && activeCategory === 'All' && !search && (
              <div
                className="mb-8 cursor-pointer group"
                onClick={() => router.push(`/dashboard/agents/${featuredAgent.slug}`)}
              >
                <div className="relative overflow-hidden rounded-2xl border-2 border-transparent bg-white p-0 shadow-sm transition-all duration-300 hover:shadow-lg"
                  style={{
                    borderImage: 'linear-gradient(135deg, #E8501A, #a855f7, #E8501A) 1',
                  }}
                >
                  <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#E8501A] to-[#a855f7] shadow-lg">
                      <Code2 className="h-8 w-8 text-white" />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold text-[#1E293B] sm:text-2xl">
                          {featuredAgent.name}
                        </h2>
                        <Badge className="bg-[#E8501A] text-white border-0">
                          FEATURED
                        </Badge>
                        <Badge className="bg-emerald-100 text-emerald-700 border-0">
                          FREE
                        </Badge>
                      </div>
                      <p className="text-[#475569] max-w-2xl">
                        {featuredAgent.description}
                      </p>
                      <div className="flex items-center gap-4 text-sm text-[#475569]">
                        <span className="flex items-center gap-1">
                          <Code2 className="h-3.5 w-3.5" />
                          Coding
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {formatCount(featuredAgent.usageCount)} uses
                        </span>
                      </div>
                    </div>
                    <div className="hidden sm:block">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#E8501A] transition-all group-hover:bg-[#E8501A] group-hover:text-white">
                        <ArrowRight className="h-5 w-5" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Agent Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(featuredAgent && activeCategory === 'All' && !search
                ? otherAgents
                : agents
              ).map((agent) => {
                const IconComponent = ICON_MAP[agent.icon] || Code2
                return (
                  <Card
                    key={agent.id}
                    className="group cursor-pointer border border-gray-100 bg-white transition-all duration-200 hover:border-[#E8501A]/30 hover:shadow-md py-0 gap-0"
                    onClick={() => router.push(`/dashboard/agents/${agent.slug}`)}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#E8501A] transition-colors group-hover:bg-[#E8501A] group-hover:text-white">
                          <IconComponent className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-[#1E293B] truncate">
                              {agent.name}
                            </h3>
                            <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px] px-1.5 py-0">
                              FREE
                            </Badge>
                          </div>
                          <p className="text-sm text-[#475569] line-clamp-2 leading-relaxed">
                            {agent.description}
                          </p>
                          <div className="flex items-center justify-between pt-1">
                            <Badge
                              variant="outline"
                              className="text-[10px] capitalize text-[#475569] border-gray-200"
                            >
                              {agent.category}
                            </Badge>
                            <span className="text-xs text-[#475569]">
                              {formatCount(agent.usageCount)} uses
                            </span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {agents.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Search className="mb-4 h-12 w-12 text-gray-300" />
                <h3 className="text-lg font-medium text-[#1E293B]">No agents found</h3>
                <p className="mt-1 text-sm text-[#475569]">
                  Try adjusting your search or filter
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}