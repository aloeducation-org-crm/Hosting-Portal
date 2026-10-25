'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
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
  ArrowLeft,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Clock,
  AlertCircle,
  ChevronRight,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuthStore } from '@/stores/authStore'
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

const LANGUAGES = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'C#',
  'C++',
  'PHP',
  'Ruby',
  'Swift',
  'Kotlin',
  'SQL',
  'HTML/CSS',
  'Bash/Shell',
  'Auto-detect',
]

const TARGET_LANGUAGES = [
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Chinese (Simplified)',
  'Chinese (Traditional)',
  'Japanese',
  'Korean',
  'Arabic',
  'Hindi',
  'Russian',
  'Dutch',
  'Polish',
  'Turkish',
  'Vietnamese',
  'Thai',
  'Indonesian',
]

interface Agent {
  id: string
  name: string
  slug: string
  description: string
  category: string
  icon: string
  systemPrompt: string
  isFree: boolean
  usageCount: number
  config: string
}

interface AgentRun {
  id: string
  input: string
  output: string | null
  status: string
  createdAt: string
  agent: {
    name: string
    slug: string
    icon: string
  }
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  )
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default function AgentRunPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const { token, isAuthenticated } = useAuthStore()

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [language, setLanguage] = useState('Auto-detect')
  const [targetLanguage, setTargetLanguage] = useState('Spanish')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)

  const refreshAgent = async () => {
    try {
      const res = await fetch(`/api/agents/${slug}`)
      const data = await res.json()
      if (data.success) {
        setAgent(data.agent)
      }
    } catch {
      // Non-critical on refresh
    }
  }

  const refreshRuns = async () => {
    if (!token) return
    try {
      const res = await fetch('/api/agents/runs', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.success) {
        setRuns(data.runs.filter((r: AgentRun) => r.agent.slug === slug).slice(0, 10))
      }
    } catch {
      // silently fail
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/agents/${slug}`)
        const data = await res.json()
        if (!cancelled && data.success) {
          setAgent(data.agent)
        } else if (!cancelled) {
          setError('Agent not found')
        }
      } catch {
        if (!cancelled) setError('Failed to load agent')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    if (!agent || !token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/agents/runs', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (!cancelled && data.success) {
          setRuns(data.runs.filter((r: AgentRun) => r.agent.slug === slug).slice(0, 10))
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoadingRuns(false)
      }
    })()
    return () => { cancelled = true }
  }, [agent, token, slug])

  const handleRun = async () => {
    if (!input.trim() || running) return
    if (!isAuthenticated || !token) {
      setError('Please log in to run agents')
      return
    }

    setRunning(true)
    setError('')
    setOutput('')

    try {
      let config: Record<string, string> | undefined
      if (agent?.slug === 'gpt5-code' && language !== 'Auto-detect') {
        config = { language }
      }
      if (agent?.slug === 'translation-agent') {
        config = { targetLanguage }
      }

      const res = await fetch(`/api/agents/${slug}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ input: input.trim(), config }),
      })

      const data = await res.json()

      if (data.success) {
        setOutput(data.output)
        // Refresh agent to update usage count
        refreshAgent()
        // Refresh runs
        refreshRuns()
      } else {
        setError(data.error || 'Failed to run agent')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setRunning(false)
    }
  }

  const handleCopy = async () => {
    if (!output) return
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="border-b bg-white">
          <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="mt-2 h-4 w-48" />
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="mt-6 h-48 rounded-xl" />
        </div>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-4 text-lg font-medium text-[#1E293B]">
            {error || 'Agent not found'}
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push('/dashboard/agents')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Agents
          </Button>
        </div>
      </div>
    )
  }

  const IconComponent = ICON_MAP[agent.icon] || Code2

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          {/* Breadcrumb */}
          <div className="mb-4 flex items-center gap-1.5 text-sm text-[#475569]">
            <button
              onClick={() => router.push('/dashboard/agents')}
              className="hover:text-[#E8501A] transition-colors"
            >
              AI Agents
            </button>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-[#1E293B] font-medium">{agent.name}</span>
          </div>

          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#E8501A] to-[#a855f7] shadow-md">
              <IconComponent className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-[#1E293B] sm:text-2xl">
                  {agent.name}
                </h1>
                {agent.isFree && (
                  <Badge className="bg-emerald-100 text-emerald-700 border-0">
                    FREE
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className="text-[#475569] border-gray-200 capitalize"
                >
                  {agent.category}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[#475569]">
                {agent.description}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-5">
          {/* Main Run Area */}
          <div className="lg:col-span-3 space-y-5">
            {/* Input Card */}
            <Card className="border-gray-100 bg-white">
              <CardContent className="p-5 space-y-4">
                {/* Config Fields */}
                {agent.slug === 'gpt5-code' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-[#1E293B]">
                      Programming Language
                    </label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 overflow-y-auto">
                        {LANGUAGES.map((lang) => (
                          <SelectItem key={lang} value={lang}>
                            {lang}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {agent.slug === 'translation-agent' && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-[#1E293B]">
                      Target Language
                    </label>
                    <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 overflow-y-auto">
                        {TARGET_LANGUAGES.map((lang) => (
                          <SelectItem key={lang} value={lang}>
                            {lang}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-[#1E293B]">
                    Your Prompt
                  </label>
                  <Textarea
                    placeholder={
                      agent.slug === 'gpt5-code'
                        ? 'e.g., Create a REST API endpoint for user authentication with JWT tokens...'
                        : agent.slug === 'translation-agent'
                          ? 'Paste the text you want to translate...'
                          : 'Describe what you need...'
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    rows={5}
                    className="resize-none text-sm leading-relaxed"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        handleRun()
                      }
                    }}
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleRun}
                  disabled={running || !input.trim()}
                  className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white h-11 text-sm font-semibold transition-all"
                >
                  {running ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Running Agent...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Run Agent
                    </>
                  )}
                </Button>
                {!running && input.trim() && (
                  <p className="text-center text-xs text-[#475569]">
                    Press <kbd className="rounded border bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium">Ctrl+Enter</kbd> to run
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Output Card */}
            {(output || running) && (
              <Card className="border-gray-100 bg-white">
                <CardHeader className="pb-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-[#1E293B]">
                      Output
                    </CardTitle>
                    {output && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCopy}
                          className="h-8 text-xs text-[#475569] hover:text-[#E8501A]"
                        >
                          {copied ? (
                            <>
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="mr-1 h-3.5 w-3.5" />
                              Copy
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleRun}
                          className="h-8 text-xs text-[#475569] hover:text-[#E8501A]"
                        >
                          <RefreshCw className="mr-1 h-3.5 w-3.5" />
                          Run Again
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  {running ? (
                    <div className="flex items-center gap-3 py-8 text-[#475569]">
                      <Loader2 className="h-5 w-5 animate-spin text-[#E8501A]" />
                      <span className="text-sm">
                        {agent.name} is thinking...
                      </span>
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-none text-[#1E293B]">
                      <div className="whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm leading-relaxed font-mono max-h-96 overflow-y-auto">
                        {output}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-2 space-y-5">
            {/* Agent Info Card */}
            <Card className="border-gray-100 bg-white">
              <CardContent className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-[#1E293B]">
                  About this Agent
                </h3>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#475569]">Category</span>
                  <Badge
                    variant="outline"
                    className="capitalize text-[#475569] border-gray-200"
                  >
                    {agent.category}
                  </Badge>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#475569]">Pricing</span>
                  <span className="font-medium text-emerald-600">Free</span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#475569]">Total Uses</span>
                  <span className="font-medium text-[#1E293B]">
                    {agent.usageCount}
                  </span>
                </div>

                {/* System Prompt Preview */}
                <div className="space-y-1.5 pt-2 border-t">
                  <button
                    onClick={() => setShowSystemPrompt(!showSystemPrompt)}
                    className="flex items-center gap-1.5 text-sm font-medium text-[#1E293B] hover:text-[#E8501A] transition-colors"
                  >
                    System Prompt
                    <ChevronRight
                      className={cn(
                        'h-3.5 w-3.5 transition-transform',
                        showSystemPrompt && 'rotate-90'
                      )}
                    />
                  </button>
                  {showSystemPrompt && (
                    <p className="text-xs text-[#475569] leading-relaxed bg-gray-50 rounded-lg p-3 line-clamp-6">
                      {agent.systemPrompt}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Run History Card */}
            <Card className="border-gray-100 bg-white">
              <CardHeader className="pb-0">
                <CardTitle className="text-sm font-semibold text-[#1E293B]">
                  Recent Runs
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                {loadingRuns ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 rounded-lg" />
                    ))}
                  </div>
                ) : runs.length === 0 ? (
                  <div className="py-6 text-center">
                    <Clock className="mx-auto h-8 w-8 text-gray-200" />
                    <p className="mt-2 text-xs text-[#475569]">
                      No runs yet. Try this agent!
                    </p>
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                    {runs.map((run) => (
                      <div
                        key={run.id}
                        className="flex items-start gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => {
                          if (run.output) setOutput(run.output)
                        }}
                      >
                        <div
                          className={cn(
                            'mt-0.5 h-2 w-2 shrink-0 rounded-full',
                            run.status === 'completed'
                              ? 'bg-emerald-500'
                              : run.status === 'failed'
                                ? 'bg-red-500'
                                : 'bg-amber-500'
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[#1E293B] line-clamp-2">
                            {run.input}
                          </p>
                          <p className="mt-1 text-[10px] text-[#475569]">
                            {timeAgo(run.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}