'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Search, RefreshCw, AlertCircle, ScrollText,
} from 'lucide-react'

interface LogEntry {
  id: string
  timestamp: string
  source: string
  level: string
  message: string
  metadata: string | null
}

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
}

const LEVEL_CONFIG: Record<string, { label: string; className: string; bold?: boolean }> = {
  debug: { label: 'Debug', className: 'bg-gray-500/15 text-gray-600 border-gray-500/30' },
  info: { label: 'Info', className: 'bg-blue-500/15 text-blue-700 border-blue-500/30' },
  warn: { label: 'Warn', className: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  error: { label: 'Error', className: 'bg-red-500/15 text-red-700 border-red-500/30' },
  fatal: { label: 'Fatal', className: 'bg-red-500/15 text-red-700 border-red-500/30 font-bold' },
}

const SOURCE_CONFIG: Record<string, string> = {
  Server: 'bg-purple-500/15 text-purple-700 border-purple-500/30',
  Container: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  Application: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  Deployment: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  System: 'bg-gray-500/15 text-gray-600 border-gray-500/30',
}

export default function LogsView() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState('All')
  const [level, setLevel] = useState('All')
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [displayCount, setDisplayCount] = useState(50)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchLogs = async () => {
    const token = getToken()
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (source !== 'All') params.set('source', source)
      if (level !== 'All') params.set('level', level)
      if (search) params.set('search', search)
      const res = await fetch(`/api/logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch logs')
      const data = await res.json()
      setLogs(data)
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
        const params = new URLSearchParams()
        if (source !== 'All') params.set('source', source)
        if (level !== 'All') params.set('level', level)
        if (search) params.set('search', search)
        const res = await fetch(`/api/logs?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch logs')
        const data = await res.json()
        if (!cancelled) {
          setLogs(data)
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
  }, [source, level, search])

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchLogs()
      }, 5000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [autoRefresh])

  const handleSearch = () => {
    setSearch(searchInput)
  }

  const displayedLogs = logs.slice(0, displayCount)
  const hasMore = displayCount < logs.length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Logs</h2>
          <p className="text-sm text-gray-500 mt-1">Aggregated log viewer across all resources</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="auto-refresh" className="text-sm text-gray-500">Auto-refresh</Label>
          <Switch
            id="auto-refresh"
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
          />
          <Button variant="outline" size="icon" onClick={() => { setLoading(true); fetchLogs() }}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Sources</SelectItem>
                <SelectItem value="Server">Server</SelectItem>
                <SelectItem value="Container">Container</SelectItem>
                <SelectItem value="Application">Application</SelectItem>
                <SelectItem value="Deployment">Deployment</SelectItem>
                <SelectItem value="System">System</SelectItem>
              </SelectContent>
            </Select>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Level" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Levels</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="fatal">Fatal</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search logs..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={handleSearch}>Search</Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
            <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchLogs() }} className="ml-auto">Retry</Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      ) : logs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ScrollText className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-500">No logs found</h3>
            <p className="text-sm text-gray-400 mt-1">Adjust your filters or wait for new log entries</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">Timestamp</TableHead>
                    <TableHead className="w-28">Source</TableHead>
                    <TableHead className="w-20">Level</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-40">Metadata</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedLogs.map((log) => {
                    const levelConf = (LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info)!
                    const sourceConf = SOURCE_CONFIG[log.source] || 'bg-gray-100 text-gray-600'
                    return (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs font-mono text-gray-500 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={sourceConf}>
                            {log.source}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={levelConf.className}>
                            {levelConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-gray-700 max-w-md">
                          <span className={log.level === 'fatal' ? 'font-bold text-red-700' : ''}>
                            {log.message}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-gray-400 font-mono max-w-[160px] truncate">
                          {log.metadata || '—'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              {hasMore && (
                <div className="flex justify-center py-4 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDisplayCount(prev => prev + 50)}
                  >
                    Load more ({logs.length - displayCount} remaining)
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}