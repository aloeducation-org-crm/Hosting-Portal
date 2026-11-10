'use client'

import { useState, useEffect, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Bot,
  Code,
  Palette,
  Megaphone,
  Shield,
  Wrench,
  HeadphonesIcon,
  Briefcase,
  Play,
  Send,
  AlertCircle,
  Inbox,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  FileText,
  Coins,
  Brain,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null }

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  coding: Code,
  design: Palette,
  marketing: Megaphone,
  business: Briefcase,
  security: Shield,
  devops: Wrench,
  utility: Wrench,
  support: HeadphonesIcon,
}

const CATEGORIES = ['All', 'Coding', 'Design', 'Marketing', 'Business', 'Security', 'DevOps', 'Utility']

interface Agent {
  id: string
  name: string
  slug: string
  description: string
  category: string
  icon: string
  isFree: boolean
  usageCount: number
  createdAt: string
}

interface AgentRun {
  id: string
  input: string
  output: string | null
  status: string
  createdAt: string
  agent: { name: string; slug: string; icon: string }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Prompt {
  id: string
  name: string
  category: string
  content: string
  variables: string[]
  usageCount: number
  createdAt: string
}

interface TokenUsageEntry {
  id: string
  date: string
  agent: string
  model: string
  promptTokens: number
  completionTokens: number
  cost: number
}

interface TokenUsageSummary {
  totalTokens: number
  totalCost: number
  mostUsedModel: string
}

export default function AgentsView() {
  const [activeTab, setActiveTab] = useState('marketplace')
  const [category, setCategory] = useState('All')
  const [agents, setAgents] = useState<Agent[]>([])
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [sending, setSending] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Prompt Library
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [promptOpen, setPromptOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
  const [promptForm, setPromptForm] = useState({ name: '', category: 'coding', content: '', variables: '' })

  // Token Usage
  const [tokenUsage, setTokenUsage] = useState<TokenUsageEntry[]>([])
  const [tokenSummary, setTokenSummary] = useState<TokenUsageSummary>({ totalTokens: 0, totalCost: 0, mostUsedModel: '—' })

  const fetchAgents = async () => {
    try {
      const params = new URLSearchParams()
      if (category !== 'All') params.set('category', category)
      const res = await fetch(`/api/agents?${params}`)
      if (!res.ok) throw new Error('Failed to fetch agents')
      const data = await res.json()
      setAgents(data.agents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const fetchRuns = async () => {
    try {
      const res = await fetch('/api/agents/runs', {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) throw new Error('Failed to fetch runs')
      const data = await res.json()
      setRuns(data.runs || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const fetchPrompts = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/ai/prompts', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch prompts')
      const data = await res.json()
      setPrompts(data || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const fetchTokenUsage = async () => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch('/api/ai/token-usage', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch token usage')
      const data = await res.json()
      setTokenUsage(data.entries || [])
      setTokenSummary(data.summary || { totalTokens: 0, totalCost: 0, mostUsedModel: '—' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (activeTab === 'marketplace') {
          const params = new URLSearchParams()
          if (category !== 'All') params.set('category', category)
          const res = await fetch(`/api/agents?${params}`)
          if (!res.ok) throw new Error('Failed to fetch agents')
          const data = await res.json()
          if (!cancelled) { setAgents(data.agents || []); setError(null); setLoading(false) }
        } else if (activeTab === 'runs') {
          const res = await fetch('/api/agents/runs', { headers: { Authorization: `Bearer ${getToken()}` } })
          if (!res.ok) throw new Error('Failed to fetch runs')
          const data = await res.json()
          if (!cancelled) { setRuns(data.runs || []); setError(null); setLoading(false) }
        } else if (activeTab === 'prompts') {
          const token = getToken()
          if (!token) return
          const res = await fetch('/api/ai/prompts', { headers: { Authorization: `Bearer ${token}` } })
          if (!res.ok) throw new Error('Failed to fetch prompts')
          const data = await res.json()
          if (!cancelled) { setPrompts(data || []); setError(null); setLoading(false) }
        } else if (activeTab === 'tokens') {
          const token = getToken()
          if (!token) return
          const res = await fetch('/api/ai/token-usage', { headers: { Authorization: `Bearer ${token}` } })
          if (!res.ok) throw new Error('Failed to fetch token usage')
          const data = await res.json()
          if (!cancelled) {
            setTokenUsage(data.entries || [])
            setTokenSummary(data.summary || { totalTokens: 0, totalCost: 0, mostUsedModel: '—' })
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
  }, [activeTab, category])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  const handleRunAgent = (agent: Agent) => {
    setSelectedAgent(agent)
    setMessages([])
    setStreamingText('')
    setInputValue('')
    setChatOpen(true)
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !selectedAgent || sending) return
    const msg = inputValue.trim()
    setInputValue('')
    setMessages((prev) => [...prev, { role: 'user', content: msg }])
    setSending(true)
    setStreamingText('')

    try {
      const res = await fetch(`/api/agents/${selectedAgent.slug}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ input: msg }),
      })

      const data = await res.json()

      if (data.success && data.output) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.output }])
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.error || 'Agent execution failed.' },
        ])
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Failed to connect to agent. Please try again.' },
      ])
    } finally {
      setSending(false)
    }
  }

  const getAgentIcon = (agent: Agent) => {
    const IconComponent = CATEGORY_ICONS[agent.category] || Bot
    return <IconComponent className="h-6 w-6" />
  }

  const openPromptCreate = () => {
    setEditingPrompt(null)
    setPromptForm({ name: '', category: 'coding', content: '', variables: '' })
    setPromptOpen(true)
  }

  const openPromptEdit = (prompt: Prompt) => {
    setEditingPrompt(prompt)
    setPromptForm({
      name: prompt.name,
      category: prompt.category,
      content: prompt.content,
      variables: prompt.variables.join(', '),
    })
    setPromptOpen(true)
  }

  const handleSavePrompt = async () => {
    const token = getToken()
    if (!token || !promptForm.name.trim() || !promptForm.content.trim()) return
    const variables = promptForm.variables.split(',').map((v) => v.trim()).filter(Boolean)
    try {
      const isEdit = !!editingPrompt
      const res = await fetch('/api/ai/prompts', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...promptForm, variables, ...(isEdit ? { id: editingPrompt.id } : {}) }),
      })
      if (!res.ok) throw new Error('Failed to save prompt')
      toast.success(isEdit ? 'Prompt updated' : 'Prompt created')
      setPromptOpen(false)
      fetchPrompts()
    } catch {
      toast.error('Failed to save prompt')
    }
  }

  const handleDeletePrompt = async (id: string) => {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(`/api/ai/prompts?id=${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to delete prompt')
      toast.success('Prompt deleted')
      setPrompts((prev) => prev.filter((p) => p.id !== id))
    } catch {
      toast.error('Failed to delete prompt')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="marketplace">Marketplace</TabsTrigger>
          <TabsTrigger value="runs">My Runs</TabsTrigger>
          <TabsTrigger value="prompts">Prompt Library</TabsTrigger>
          <TabsTrigger value="tokens">Token Usage</TabsTrigger>
        </TabsList>

        {/* Marketplace Tab */}
        <TabsContent value="marketplace">
          <div className="flex flex-wrap gap-2 mb-6">
            {CATEGORIES.map((cat) => (
              <Button
                key={cat}
                variant={category === cat ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategory(cat)}
                className={category === cat ? 'bg-[#E8501A] hover:bg-[#5B2FC9]' : ''}
              >
                {cat}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
                <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchAgents().finally(() => setLoading(false)) }} className="ml-auto">Retry</Button>
              </CardContent>
            </Card>
          ) : agents.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Bot className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No agents found</h3>
                <p className="text-sm text-gray-400 mt-1">Try selecting a different category</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <Card key={agent.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8501A]/10 text-[#E8501A]">
                          {getAgentIcon(agent)}
                        </div>
                        <div>
                          <CardTitle className="text-base">{agent.name}</CardTitle>
                          <p className="text-xs text-gray-400 mt-0.5">{agent.usageCount} runs</p>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <Badge variant="secondary" className="text-[10px] capitalize">
                          {agent.category}
                        </Badge>
                        <Badge variant={agent.isFree ? 'secondary' : 'default'} className="text-[10px] bg-[#E8501A]">
                          {agent.isFree ? 'Free' : 'Paid'}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-500 line-clamp-2 mb-4">{agent.description}</p>
                    <Button
                      size="sm"
                      onClick={() => handleRunAgent(agent)}
                      className="w-full bg-[#E8501A] hover:bg-[#5B2FC9]"
                    >
                      <Play className="h-3.5 w-3.5 mr-1.5" />
                      Run Agent
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* My Runs Tab */}
        <TabsContent value="runs">
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
                <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchRuns().finally(() => setLoading(false)) }} className="ml-auto">Retry</Button>
              </CardContent>
            </Card>
          ) : runs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Inbox className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No runs yet</h3>
                <p className="text-sm text-gray-400 mt-1">Run an agent from the marketplace to see your history here</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Input</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">{run.agent?.name || 'Unknown'}</TableCell>
                        <TableCell className="max-w-xs truncate text-gray-500 text-sm">
                          {run.input}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              run.status === 'completed'
                                ? 'bg-green-100 text-green-700'
                                : run.status === 'running'
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }
                          >
                            {run.status === 'completed' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                            {run.status === 'running' && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                            {run.status === 'failed' && <XCircle className="h-3 w-3 mr-1" />}
                            {run.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-400 text-sm">
                          {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Prompt Library Tab */}
        <TabsContent value="prompts">
          <div className="flex justify-end mb-6">
            <Button onClick={openPromptCreate} className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white">
              <Plus className="mr-2 h-4 w-4" /> Create Prompt
            </Button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
                <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchPrompts().finally(() => setLoading(false)) }} className="ml-auto">Retry</Button>
              </CardContent>
            </Card>
          ) : prompts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No prompts yet</h3>
                <p className="text-sm text-gray-400 mt-1">Create prompt templates for your AI agents</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {prompts.map((prompt) => (
                <Card key={prompt.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8501A]/10 text-[#E8501A]">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{prompt.name}</CardTitle>
                          <p className="text-xs text-gray-400 mt-0.5">{prompt.usageCount} uses</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-[#E8501A]" onClick={() => openPromptEdit(prompt)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-gray-400 hover:text-red-600" onClick={() => handleDeletePrompt(prompt.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="secondary" className="text-[10px] capitalize mb-3">{prompt.category}</Badge>
                    <p className="text-sm text-gray-500 line-clamp-3 mb-3">{prompt.content}</p>
                    {prompt.variables.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {prompt.variables.map((v) => (
                          <Badge key={v} variant="outline" className="text-[10px] font-mono bg-gray-50">{'{{' + v + '}}'}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Token Usage Tab */}
        <TabsContent value="tokens">
          {loading ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
              </div>
              <Skeleton className="h-14 rounded-lg" />
            </div>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
                <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchTokenUsage().finally(() => setLoading(false)) }} className="ml-auto">Retry</Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600">
                        <Brain className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Total Tokens</p>
                        <p className="text-xl font-bold text-gray-900">{tokenSummary.totalTokens.toLocaleString()}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                        <Coins className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Total Cost</p>
                        <p className="text-xl font-bold text-gray-900">${tokenSummary.totalCost.toFixed(2)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8501A]/10 text-[#E8501A]">
                        <Bot className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">Most Used Model</p>
                        <p className="text-lg font-bold text-gray-900">{tokenSummary.mostUsedModel}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {tokenUsage.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Coins className="h-12 w-12 text-gray-300 mb-4" />
                    <h3 className="text-lg font-medium text-gray-500">No usage data</h3>
                    <p className="text-sm text-gray-400 mt-1">Token usage will appear here after running agents</p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Model</TableHead>
                          <TableHead className="text-right">Prompt Tokens</TableHead>
                          <TableHead className="text-right">Completion Tokens</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tokenUsage.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="text-sm text-gray-500">
                              {formatDistanceToNow(new Date(entry.date), { addSuffix: true })}
                            </TableCell>
                            <TableCell className="font-medium">{entry.agent}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="text-[10px]">{entry.model}</Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm text-gray-600">{entry.promptTokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-sm text-gray-600">{entry.completionTokens.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-sm font-medium">${entry.cost.toFixed(4)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Agent Run Dialog */}
      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="sm:max-w-2xl flex flex-col max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedAgent && (
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8501A]/10 text-[#E8501A]">
                  {getAgentIcon(selectedAgent)}
                </div>
              )}
              <div>
                <span>{selectedAgent?.name}</span>
                <p className="text-sm font-normal text-gray-400">{selectedAgent?.description}</p>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 flex flex-col">
            <ScrollArea className="flex-1 min-h-0 max-h-96 rounded-lg border bg-gray-50 p-4 mb-4">
              {messages.length === 0 && !sending && (
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                  <Bot className="h-8 w-8 mb-2" />
                  <p className="text-sm">Send a message to start the conversation</p>
                </div>
              )}
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                        msg.role === 'user'
                          ? 'bg-[#E8501A] text-white'
                          : 'bg-white border text-gray-700'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {streamingText && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg bg-white border px-3 py-2 text-sm text-gray-700 whitespace-pre-wrap">
                      {streamingText}
                      <span className="animate-pulse">|</span>
                    </div>
                  </div>
                )}
                {sending && !streamingText && (
                  <div className="flex justify-start">
                    <div className="rounded-lg bg-white border px-4 py-2">
                      <div className="flex gap-1">
                        <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div ref={messagesEndRef} />
            </ScrollArea>

            <div className="flex gap-2">
              <Input
                placeholder="Type your message..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                disabled={sending}
                className="flex-1"
              />
              <Button
                onClick={handleSendMessage}
                disabled={sending || !inputValue.trim()}
                className="bg-[#E8501A] hover:bg-[#5B2FC9]"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Prompt Create/Edit Dialog */}
      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPrompt ? 'Edit Prompt' : 'Create Prompt'}</DialogTitle>
            <DialogDescription>
              {editingPrompt ? 'Update an existing prompt template.' : 'Create a new prompt template for your AI agents.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="prompt-name">Name *</Label>
                <Input id="prompt-name" value={promptForm.name} onChange={(e) => setPromptForm({ ...promptForm, name: e.target.value })} placeholder="My Prompt" />
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={promptForm.category} onValueChange={(v) => setPromptForm({ ...promptForm, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="coding">Coding</SelectItem>
                    <SelectItem value="design">Design</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                    <SelectItem value="security">Security</SelectItem>
                    <SelectItem value="devops">DevOps</SelectItem>
                    <SelectItem value="utility">Utility</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prompt-content">Content *</Label>
              <Textarea
                id="prompt-content"
                value={promptForm.content}
                onChange={(e) => setPromptForm({ ...promptForm, content: e.target.value })}
                placeholder="Write your prompt template here... Use {{variable_name}} for variables."
                rows={6}
                className="font-mono text-sm"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prompt-variables">Variables (comma-separated)</Label>
              <Input
                id="prompt-variables"
                value={promptForm.variables}
                onChange={(e) => setPromptForm({ ...promptForm, variables: e.target.value })}
                placeholder="topic, tone, language"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromptOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSavePrompt}
              className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
              disabled={!promptForm.name.trim() || !promptForm.content.trim()}
            >
              {editingPrompt ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}