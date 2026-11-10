'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  GitBranch, Play, ChevronDown, ChevronUp, Clock, GitCommit,
  Box, AlertCircle, CheckCircle, Loader2, XCircle, Rocket,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'

interface AppMini {
  id: string
  name: string
  status: string
}

interface Deployment {
  id: string
  version: string
  status: string
  commit: string | null
  commitMessage: string | null
  branch: string | null
  triggeredBy: string
  duration: number
  startedAt: string
  completedAt: string | null
  application: AppMini
  buildOutput?: string | null
}

const DEPLOY_STATUS: Record<string, { label: string; className: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { label: 'Pending', className: 'bg-gray-500/15 text-gray-600 border-gray-500/30', icon: Clock },
  building: { label: 'Building', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30', icon: Loader2 },
  deploying: { label: 'Deploying', className: 'bg-purple-500/15 text-purple-700 border-purple-500/30', icon: Rocket },
  live: { label: 'Live', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', icon: CheckCircle },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-700 border-red-500/30', icon: XCircle },
  rolled_back: { label: 'Rolled Back', className: 'bg-orange-500/15 text-orange-700 border-orange-500/30', icon: AlertCircle },
}

// Build logs are now sourced from the deployment's buildOutput field from the API.
// If buildOutput is null/empty, a "No build logs available" message is shown.

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-72" />
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
      </div>
    </div>
  )
}

export default function CICDView() {
  const [apps, setApps] = useState<AppMini[]>([])
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [triggering, setTriggering] = useState<string | null>(null)

  const loadPipelines = async () => {
    const token = getToken()
    if (!token) return
    try {
      const [appsRes, depRes] = await Promise.all([
        fetch('/api/applications', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/ci-cd/pipelines', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!appsRes.ok || !depRes.ok) throw new Error('Failed to fetch')
      const appsData = await appsRes.json()
      setApps(appsData.map((a: { id: string; name: string; status: string }) => ({ id: a.id, name: a.name, status: a.status })))
      setDeployments(await depRes.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const token = getToken()
      if (!token) return
      try {
        const [appsRes, depRes] = await Promise.all([
          fetch('/api/applications', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/ci-cd/pipelines', { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (!appsRes.ok || !depRes.ok) throw new Error('Failed to fetch')
        const appsData = await appsRes.json()
        const deps = await depRes.json()
        if (!cancelled) {
          setApps(appsData.map((a: { id: string; name: string; status: string }) => ({ id: a.id, name: a.name, status: a.status })))
          setDeployments(deps)
          setError(null)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unknown error')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleTriggerDeploy = async (appId: string, appName: string) => {
    const token = getToken()
    if (!token) return
    setTriggering(appName)
    try {
      const res = await fetch('/api/ci-cd/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ appId, appName }),
      })
      if (!res.ok) throw new Error('Failed to trigger deployment')
      await loadPipelines()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trigger deployment')
    } finally {
      setTriggering(null)
    }
  }

  const getLatestDeployment = (appId: string) => {
    return deployments.find((d) => d.application.id === appId)
  }

  if (loading) return <div className="p-6"><LoadingSkeleton /></div>

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">CI / CD</h2>
        <p className="text-sm text-gray-500 mt-1">Manage pipelines, deployments, and build history</p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      <Tabs defaultValue="pipelines" className="space-y-4">
        <TabsList className="bg-gray-100">
          <TabsTrigger value="pipelines" className="gap-1.5">
            <GitBranch className="h-3.5 w-3.5" /> Pipelines
          </TabsTrigger>
          <TabsTrigger value="deployments" className="gap-1.5">
            <Rocket className="h-3.5 w-3.5" /> Deployments
          </TabsTrigger>
        </TabsList>

        {/* Pipelines Tab */}
        <TabsContent value="pipelines" className="space-y-3">
          {apps.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <GitBranch className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-semibold text-gray-600">No pipelines configured</h3>
                <p className="text-sm text-gray-400 mt-1">Deploy an application to create a pipeline</p>
              </CardContent>
            </Card>
          ) : (
            apps.map((app) => {
              const latest = getLatestDeployment(app.id)
              const statusConf = latest ? DEPLOY_STATUS[latest.status] : null
              return (
                <Card key={app.id} className="border-gray-200 hover:border-[#E8501A]/20 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8501A]/10">
                          <Box className="h-5 w-5 text-[#E8501A]" />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900">{app.name}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            {latest?.branch && (
                              <span className="text-xs text-gray-400 flex items-center gap-1">
                                <GitBranch className="h-3 w-3" /> {latest.branch}
                              </span>
                            )}
                            {latest?.commitMessage && (
                              <span className="text-xs text-gray-400 truncate max-w-[200px]">
                                {latest.commitMessage}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {statusConf && (
                          <Badge variant="outline" className={statusConf.className}>
                            <statusConf.icon className={`mr-1 h-3 w-3 ${latest?.status === 'building' || latest?.status === 'deploying' ? 'animate-spin' : ''}`} />
                            {statusConf.label}
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          onClick={() => handleTriggerDeploy(app.id, app.name)}
                          disabled={triggering === app.name}
                          className="bg-[#E8501A] hover:bg-[#5B2FC9] text-white"
                        >
                          {triggering === app.name ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Trigger Deploy
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </TabsContent>

        {/* Deployments Tab */}
        <TabsContent value="deployments">
          <Card className="border-gray-200">
            <CardContent className="p-0">
              {deployments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Rocket className="h-12 w-12 text-gray-300 mb-4" />
                  <h3 className="text-lg font-semibold text-gray-600">No deployments yet</h3>
                  <p className="text-sm text-gray-400 mt-1">Trigger a deployment from the Pipelines tab</p>
                </div>
              ) : (
                <div className="max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Application</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Commit</TableHead>
                        <TableHead>Triggered By</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Timestamp</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deployments.map((dep) => {
                        const statusConf = (DEPLOY_STATUS[dep.status] || DEPLOY_STATUS.pending)!
                        return (
                          <React.Fragment key={dep.id}>
                            <TableRow className="hover:bg-gray-50">
                              <TableCell className="font-medium text-sm">{dep.application.name}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs font-mono">v{dep.version}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={statusConf.className}>
                                  <statusConf.icon className={`mr-1 h-3 w-3 ${dep.status === 'building' || dep.status === 'deploying' ? 'animate-spin' : ''}`} />
                                  {statusConf.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-gray-500 font-mono max-w-[120px] truncate">
                                {dep.commit ? (
                                  <span className="flex items-center gap-1">
                                    <GitCommit className="h-3 w-3 shrink-0" />
                                    {dep.commit.slice(0, 7)}
                                  </span>
                                ) : '—'}
                              </TableCell>
                              <TableCell className="text-xs text-gray-500 capitalize">{dep.triggeredBy}</TableCell>
                              <TableCell className="text-xs text-gray-500">
                                {dep.duration > 0 ? `${dep.duration}s` : '—'}
                              </TableCell>
                              <TableCell className="text-xs text-gray-400">
                                {formatDistanceToNow(new Date(dep.startedAt), { addSuffix: true })}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => setExpandedLog(expandedLog === dep.id ? null : dep.id)}
                                >
                                  {expandedLog === dep.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </Button>
                              </TableCell>
                            </TableRow>
                            {expandedLog === dep.id && (
                              <TableRow key={`${dep.id}-log`}>
                                <TableCell colSpan={8} className="bg-gray-950 p-0">
                                  <div className="p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-0.5">
                                    {dep.buildOutput ? (
                                      dep.buildOutput.split('\n').map((line, i) => (
                                        <p key={i} className="text-gray-300">
                                          <span className="text-gray-600 mr-2">{String(i + 1).padStart(2, '0')}</span>
                                          {line}
                                        </p>
                                      ))
                                    ) : (
                                      <p className="text-gray-500">No build logs available for this deployment.</p>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}