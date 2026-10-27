'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/authStore'
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Loader2,
  Eye,
  Code2,
  Globe,
  Check,
  LayoutTemplate,
  ShoppingBag,
  Briefcase,
  Newspaper,
  FileText,
  Layers,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type Step = 'describe' | 'preview' | 'publish'

const WEBSITE_TYPES = [
  { value: 'business', label: 'Business', icon: Briefcase, description: 'Company, startup, or agency website' },
  { value: 'portfolio', label: 'Portfolio', icon: LayoutTemplate, description: 'Showcase your work and projects' },
  { value: 'blog', label: 'Blog', icon: Newspaper, description: 'Articles, news, or personal blog' },
  { value: 'ecommerce', label: 'Ecommerce', icon: ShoppingBag, description: 'Online store with products' },
  { value: 'landing', label: 'Landing Page', icon: Layers, description: 'Single-page marketing or product page' },
  { value: 'other', label: 'Other', icon: FileText, description: 'Custom website type' },
]

interface Domain {
  id: string
  name: string
  status: string
}

const STEPS = [
  { key: 'describe', label: 'Describe', number: 1 },
  { key: 'preview', label: 'Preview & Edit', number: 2 },
  { key: 'publish', label: 'Publish', number: 3 },
]

export default function NewWebsitePage() {
  const router = useRouter()
  const { token } = useAuthStore()

  // Step state
  const [step, setStep] = useState<Step>('describe')

  // Step 1: Describe
  const [description, setDescription] = useState('')
  const [websiteType, setWebsiteType] = useState<string>('business')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')

  // Step 2: Preview
  const [websiteName, setWebsiteName] = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const [aiTitle, setAiTitle] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const previewRef = useRef<HTMLIFrameElement>(null)

  // Step 3: Publish
  const [publishNameOverride, setPublishNameOverride] = useState('')
  const publishName = publishNameOverride || websiteName || aiTitle
  const [selectedDomainId, setSelectedDomainId] = useState<string>('default')
  const [domains, setDomains] = useState<Domain[]>([])
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')



  const generateWebsite = useCallback(async (desc: string, type: string) => {
    setGenerating(true)
    setGenerateError('')
    try {
      const res = await fetch('/api/ai/website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ description: desc, type }),
      })
      const data = await res.json()
      const payload = data?.data ?? data
      if (res.ok && data.success && payload?.html) {
        setHtmlContent(payload.html)
        setAiTitle(payload.title || 'My Website')
        setWebsiteName(payload.title || '')
        setStep('preview')
      } else {
        const errMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message
        setGenerateError(errMsg || 'Failed to generate website')
      }
    } catch {
      setGenerateError('Network error. Please try again.')
    } finally {
      setGenerating(false)
    }
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (!description.trim()) return
    setRegenerating(true)
    try {
      const res = await fetch('/api/ai/website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ description, type: websiteType }),
      })
      const data = await res.json()
      const payload = data?.data ?? data
      if (res.ok && data.success && payload?.html) {
        setHtmlContent(payload.html)
        setAiTitle(payload.title || 'My Website')
        setWebsiteName(payload.title || '')
      }
    } catch {
      // Silently fail on regenerate
    } finally {
      setRegenerating(false)
    }
  }, [description, websiteType])

  // When moving to publish step, fetch domains
  useEffect(() => {
    if (step !== 'publish') return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/domains/mine', {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (res.ok && !cancelled) {
          const data = await res.json()
          const list = Array.isArray(data) ? data : (data.data || data.domains || [])
          setDomains(list.filter((d: Domain) => d.status === 'active' || d.status === 'verified'))
        }
      } catch {
        // No domains available
      }
    })()
    return () => { cancelled = true }
  }, [step, token])

  const handlePublish = useCallback(async () => {
    if (!publishName.trim() || !htmlContent.trim()) return
    setPublishing(true)
    setPublishError('')
    try {
      const slug = publishName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'ai-site'
      const chosenDomain =
        selectedDomainId !== 'default'
          ? domains.find((d) => d.id === selectedDomainId)?.name || `${slug}.apps.alolabs.net`
          : `${slug}.apps.alolabs.net`

      const res = await fetch('/api/ai/deploy-assistant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'deploy',
          blueprint: {
            projectName: publishName.trim(),
            workspaceName: 'AI Builder Sites',
            stackId: 'static-spa',
            domain: chosenDomain,
            gitRepo: '',
            gitBranch: 'main',
            buildCommand: '',
            startCommand: '',
            outputDirectory: 'dist',
            autoSsl: true,
            securityProfile: 'strict-waf',
            database: { enabled: false, engine: 'POSTGRESQL', name: `${slug.replace(/-/g, '_')}_db` },
            resources: {
              tier: 'starter',
              cpuCores: 1,
              memoryMb: 1024,
              storageGb: 10,
              edgeCache: true,
              compression: true,
            },
            backups: { enabled: true, frequency: 'daily' },
            selfHealing: { enabled: true, healthPath: '/', autoRollback: true },
            envVars: [],
          },
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        router.push('/sites')
      } else {
        const errMsg = typeof data?.error === 'string' ? data.error : data?.error?.message || data?.message
        setPublishError(errMsg || 'Failed to publish website')
      }
    } catch {
      setPublishError('Network error. Please try again.')
    } finally {
      setPublishing(false)
    }
  }, [publishName, htmlContent, selectedDomainId, domains, router])

  const currentStepIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => (step === 'describe' ? router.push('/dashboard/websites') : setStep('describe'))}
          className="flex items-center gap-2 text-sm text-[#475569] hover:text-[#E8501A] transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {step === 'describe' ? 'Websites' : 'Describe'}
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8501A]/10">
            <Sparkles className="h-5 w-5 text-[#E8501A]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1E293B]">AI Website Builder</h1>
            <p className="text-sm text-[#475569]">
              Describe your website and let AI build it for you
            </p>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="mb-8">
        <div className="flex items-center gap-0">
          {STEPS.map((s, idx) => (
            <div key={s.key} className="flex items-center flex-1">
              <div
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer',
                  step === s.key && 'bg-[#E8501A] text-white shadow-sm',
                  step !== s.key && currentStepIndex > idx && 'bg-[#E8501A]/10 text-[#E8501A]',
                  step !== s.key && currentStepIndex < idx && 'text-[#9CA3AF] cursor-default',
                )}
                onClick={() => {
                  if (idx < currentStepIndex) setStep(s.key as Step)
                }}
              >
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0',
                    step === s.key && 'bg-white/20 text-white',
                    step !== s.key && currentStepIndex > idx && 'bg-[#E8501A] text-white',
                    step !== s.key && currentStepIndex < idx && 'bg-gray-200 text-[#9CA3AF]',
                  )}
                >
                  {currentStepIndex > idx ? <Check className="h-3.5 w-3.5" /> : s.number}
                </div>
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mx-2',
                    currentStepIndex > idx ? 'bg-[#E8501A]' : 'bg-gray-200',
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: Describe */}
      {step === 'describe' && (
        <div className="max-w-3xl mx-auto">
          <Card className="border-gray-100 shadow-sm">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-[#1E293B] mb-1">
                  Describe your website
                </h2>
                <p className="text-sm text-[#475569]">
                  Tell us what you want to build. Be as detailed as you like.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="text-sm font-medium text-[#1E293B]">
                  Website description
                </Label>
                <Textarea
                  id="description"
                  placeholder="e.g., A modern restaurant website with a hero image, menu section with prices, about us, photo gallery, reservation form, and contact information with a map. Use warm colors like burgundy and gold."
                  className="min-h-[160px] text-sm resize-y"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <p className="text-xs text-[#9CA3AF]">
                  The more details you provide, the better the result.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-[#1E293B]">
                  Website type
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {WEBSITE_TYPES.map((t) => {
                    const Icon = t.icon
                    return (
                      <button
                        key={t.value}
                        onClick={() => setWebsiteType(t.value)}
                        className={cn(
                          'flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center transition-all cursor-pointer',
                          websiteType === t.value
                            ? 'border-[#E8501A] bg-[#FFF7ED] shadow-sm'
                            : 'border-gray-200 hover:border-[#E8501A]/30 hover:bg-[#FFF7ED]/50',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-6 w-6',
                            websiteType === t.value ? 'text-[#E8501A]' : 'text-[#475569]',
                          )}
                        />
                        <span
                          className={cn(
                            'text-sm font-medium',
                            websiteType === t.value ? 'text-[#E8501A]' : 'text-[#1E293B]',
                          )}
                        >
                          {t.label}
                        </span>
                        <span className="text-[10px] text-[#9CA3AF] leading-tight hidden sm:block">
                          {t.description}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {generateError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600">
                  {generateError}
                </div>
              )}

              <Button
                onClick={() => generateWebsite(description, websiteType)}
                disabled={!description.trim() || generating}
                className="w-full bg-[#E8501A] hover:bg-[#C73D12] text-white h-12 text-base font-semibold"
              >
                {generating ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Generating your website...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    Generate with AI
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 2: Preview & Edit */}
      {step === 'preview' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Input
                placeholder="Website name..."
                value={websiteName}
                onChange={(e) => setWebsiteName(e.target.value)}
                className="max-w-xs h-10 text-sm"
              />
              <Badge variant="outline" className="text-[10px] capitalize text-[#475569] border-gray-200">
                {websiteType}
              </Badge>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={regenerating}
                className="text-sm"
              >
                {regenerating ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Regenerate
              </Button>
              <Button
                onClick={() => setStep('publish')}
                className="bg-[#E8501A] hover:bg-[#C73D12] text-white text-sm"
              >
                Next: Publish
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Split view */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[600px]">
            {/* Code Editor */}
            <div className="flex flex-col min-h-[400px] lg:min-h-0">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 rounded-t-lg">
                <Code2 className="h-4 w-4 text-gray-400" />
                <span className="text-xs font-medium text-gray-400">HTML Editor</span>
              </div>
              <Textarea
                value={htmlContent}
                onChange={(e) => setHtmlContent(e.target.value)}
                className="flex-1 min-h-[400px] lg:min-h-0 font-mono text-xs leading-relaxed bg-gray-950 text-gray-300 border-0 rounded-t-none rounded-b-lg resize-none p-4 focus-visible:ring-1 focus-visible:ring-[#E8501A]"
                spellCheck={false}
              />
            </div>

            {/* Live Preview */}
            <div className="flex flex-col min-h-[400px] lg:min-h-0">
              <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-t-lg">
                <Eye className="h-4 w-4 text-[#475569]" />
                <span className="text-xs font-medium text-[#475569]">Live Preview</span>
              </div>
              <div className="flex-1 min-h-[400px] lg:min-h-0 bg-white border border-t-0 border-gray-200 rounded-b-lg overflow-hidden">
                <iframe
                  ref={previewRef}
                  srcDoc={htmlContent}
                  sandbox="allow-scripts"
                  className="w-full h-full border-0"
                  title="Website Preview"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Publish */}
      {step === 'publish' && (
        <div className="max-w-xl mx-auto">
          <Card className="border-gray-100 shadow-sm">
            <CardContent className="p-6 sm:p-8 space-y-6">
              <div className="text-center">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E8501A]/10 mb-3">
                  <Globe className="h-7 w-7 text-[#E8501A]" />
                </div>
                <h2 className="text-xl font-bold text-[#1E293B]">Publish Your Website</h2>
                <p className="text-sm text-[#475569] mt-1">
                  Name your website and choose where to publish it.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="publishName" className="text-sm font-medium text-[#1E293B]">
                  Website name
                </Label>
                <Input
                  id="publishName"
                  placeholder="My Awesome Website"
                  value={publishName}
                  onChange={(e) => setPublishNameOverride(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium text-[#1E293B]">
                  Domain
                </Label>
                <Select value={selectedDomainId} onValueChange={setSelectedDomainId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      <div className="flex flex-col">
                        <span>Use default subdomain</span>
                        <span className="text-xs text-[#9CA3AF]">
                          {publishName.trim().toLowerCase().replace(/\s+/g, '-') || 'my-site'}.alolabs.net
                        </span>
                      </div>
                    </SelectItem>
                    {domains.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-[#475569]" />
                          {d.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedDomainId === 'default' && publishName.trim() && (
                  <p className="text-xs text-[#475569]">
                    Your website will be available at{' '}
                    <span className="font-medium text-[#E8501A]">
                      {publishName.trim().toLowerCase().replace(/\s+/g, '-')}.alolabs.net
                    </span>
                  </p>
                )}
              </div>

              {/* Preview summary */}
              <div className="rounded-lg bg-[#FFF7ED] border border-[#E8501A]/10 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-[#1E293B]">Website Summary</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[#9CA3AF]">Name:</span>{' '}
                    <span className="text-[#1E293B] font-medium">{publishName || 'Untitled'}</span>
                  </div>
                  <div>
                    <span className="text-[#9CA3AF]">Type:</span>{' '}
                    <span className="text-[#1E293B] font-medium capitalize">{websiteType}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[#9CA3AF]">Content size:</span>{' '}
                    <span className="text-[#1E293B] font-medium">{(htmlContent.length / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
              </div>

              {publishError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600">
                  {publishError}
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep('preview')}
                  className="flex-1"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={handlePublish}
                  disabled={!publishName.trim() || publishing}
                  className="flex-1 bg-[#E8501A] hover:bg-[#C73D12] text-white h-11 font-semibold"
                >
                  {publishing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Globe className="mr-2 h-4 w-4" />
                      Publish Website
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}