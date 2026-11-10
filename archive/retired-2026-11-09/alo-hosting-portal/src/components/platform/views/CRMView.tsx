'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import {
  Plus,
  Search,
  AlertCircle,
  Inbox,
  Users,
  HandshakeIcon,
  LayoutGrid,
  GripVertical,
  DollarSign,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'

function getToken() { return typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null }

const CONTACT_STATUSES = [
  { value: 'lead', label: 'Lead', color: 'bg-purple-100 text-purple-700' },
  { value: 'prospect', label: 'Prospect', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'customer', label: 'Customer', color: 'bg-green-100 text-green-700' },
  { value: 'churned', label: 'Churned', color: 'bg-gray-100 text-gray-600' },
]

const CONTACT_SOURCES = ['manual', 'import', 'form', 'referral']

const PIPELINE_STAGES = [
  { key: 'Lead', color: 'border-t-purple-500' },
  { key: 'Qualified', color: 'border-t-yellow-500' },
  { key: 'Proposal', color: 'border-t-purple-500' },
  { key: 'Negotiation', color: 'border-t-orange-500' },
  { key: 'Closed Won', color: 'border-t-green-500' },
  { key: 'Closed Lost', color: 'border-t-red-400' },
]

interface Contact {
  id: string
  firstName: string
  lastName: string | null
  email: string | null
  phone: string | null
  company: string | null
  title: string | null
  status: string
  source: string
  createdAt: string
}

interface Deal {
  id: string
  title: string
  value: number
  currency: string
  stage: string
  probability: number
  expectedCloseDate: string | null
  createdAt: string
  contact: { id: string; firstName: string; lastName: string | null; email: string | null; company: string | null } | null
  pipeline: { id: string; name: string } | null
}

interface Pipeline {
  id: string
  name: string
  stages: string
  isDefault: boolean
}

function getAuthHeaders() { return { headers: { Authorization: `Bearer ${getToken()}` } } }

function DraggableDealCard({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: deal.id,
  })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="bg-white shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing"
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0" {...listeners} {...attributes}>
            <GripVertical className="h-4 w-4 text-gray-300 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{deal.title}</p>
              {deal.contact && (
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {deal.contact.firstName} {deal.contact.lastName || ''}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t">
          <span className="text-sm font-semibold text-[#E8501A]">
            ${deal.value.toLocaleString()}
          </span>
          <div className="flex items-center gap-1.5">
            <div className="w-12 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#E8501A] rounded-full"
                style={{ width: `${deal.probability}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-400">{deal.probability}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DroppableColumn({ stageKey, color, children }: { stageKey: string; color: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: stageKey })
  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-72 rounded-xl border border-t-4 ${color} bg-gray-50/50 flex flex-col`}
    >
      {children}
    </div>
  )
}

export default function CRMView() {
  const [activeTab, setActiveTab] = useState('contacts')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Contacts
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [contactDialogOpen, setContactDialogOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [contactForm, setContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    status: 'lead',
    source: 'manual',
  })

  // Deals
  const [deals, setDeals] = useState<Deal[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [dealDialogOpen, setDealDialogOpen] = useState(false)
  const [dealForm, setDealForm] = useState({
    title: '',
    contactId: '',
    value: '',
    pipelineId: '',
    stage: 'Lead',
    probability: '20',
    expectedCloseDate: '',
  })

  const fetchContacts = async (search = '') => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/crm/contacts?${params}`, getAuthHeaders())
      if (!res.ok) throw new Error('Failed to fetch contacts')
      const data = await res.json()
      setContacts(data.contacts || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const fetchDeals = async () => {
    try {
      const res = await fetch('/api/crm/deals', getAuthHeaders())
      if (!res.ok) throw new Error('Failed to fetch deals')
      const data = await res.json()
      setDeals(data.deals || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const fetchPipelines = async () => {
    try {
      const res = await fetch('/api/crm/pipelines', getAuthHeaders())
      if (!res.ok) throw new Error('Failed to fetch pipelines')
      const data = await res.json()
      setPipelines(data.pipelines || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (activeTab === 'contacts') {
          const params = new URLSearchParams()
          const res = await fetch(`/api/crm/contacts?${params}`, getAuthHeaders())
          if (!res.ok) throw new Error('Failed to fetch contacts')
          const data = await res.json()
          if (!cancelled) {
            setContacts(data.contacts || [])
            setError(null)
            setLoading(false)
          }
        } else if (activeTab === 'deals' || activeTab === 'pipeline') {
          const [dealsRes, pipesRes] = await Promise.all([
            fetch('/api/crm/deals', getAuthHeaders()),
            fetch('/api/crm/pipelines', getAuthHeaders()),
          ])
          if (!dealsRes.ok || !pipesRes.ok) throw new Error('Failed to fetch')
          const [dealsData, pipesData] = await Promise.all([dealsRes.json(), pipesRes.json()])
          if (!cancelled) {
            setDeals(dealsData.deals || [])
            setPipelines(pipesData.pipelines || [])
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
  }, [activeTab])

  // Contact handlers
  const openContactDialog = (contact?: Contact) => {
    if (contact) {
      setEditingContact(contact)
      setContactForm({
        firstName: contact.firstName,
        lastName: contact.lastName || '',
        email: contact.email || '',
        phone: contact.phone || '',
        company: contact.company || '',
        title: contact.title || '',
        status: contact.status,
        source: contact.source,
      })
    } else {
      setEditingContact(null)
      setContactForm({ firstName: '', lastName: '', email: '', phone: '', company: '', title: '', status: 'lead', source: 'manual' })
    }
    setContactDialogOpen(true)
  }

  const handleSaveContact = async () => {
    if (!contactForm.firstName.trim()) return
    try {
      if (editingContact) {
        const res = await fetch(`/api/crm/contacts/${editingContact.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify(contactForm),
        })
        if (!res.ok) throw new Error('Failed to update contact')
        toast.success('Contact updated')
      } else {
        const res = await fetch('/api/crm/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify(contactForm),
        })
        if (!res.ok) throw new Error('Failed to create contact')
        toast.success('Contact created')
      }
      setContactDialogOpen(false)
      await fetchContacts(contactSearch)
    } catch {
      toast.error('Failed to save contact')
    }
  }

  const handleSearchContacts = (val: string) => {
    setContactSearch(val)
    fetchContacts(val)
  }

  // Deal handlers
  const openDealDialog = () => {
    setDealForm({ title: '', contactId: '', value: '', pipelineId: pipelines.find(p => p.isDefault)?.id || '', stage: 'Lead', probability: '20', expectedCloseDate: '' })
    setDealDialogOpen(true)
  }

  const handleSaveDeal = async () => {
    if (!dealForm.title.trim()) return
    try {
      const res = await fetch('/api/crm/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          ...dealForm,
          value: parseFloat(dealForm.value) || 0,
          probability: parseInt(dealForm.probability) || 20,
        }),
      })
      if (!res.ok) throw new Error('Failed to create deal')
      toast.success('Deal created')
      setDealDialogOpen(false)
      await fetchDeals()
    } catch {
      toast.error('Failed to create deal')
    }
  }

  const contactStatusColor = (status: string) => {
    return CONTACT_STATUSES.find(s => s.value === status)?.color || 'bg-gray-100 text-gray-600'
  }

  const filteredContacts = contactSearch
    ? contacts
    : contacts

  // Pipeline data
  const pipelineDeals = PIPELINE_STAGES.map(stage => ({
    ...stage,
    deals: deals.filter(d => d.stage === stage.key),
    totalValue: deals.filter(d => d.stage === stage.key).reduce((sum, d) => sum + d.value, 0),
  }))

  return (
    <div className="p-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="contacts" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Contacts</TabsTrigger>
          <TabsTrigger value="deals" className="gap-1.5"><HandshakeIcon className="h-3.5 w-3.5" /> Deals</TabsTrigger>
          <TabsTrigger value="pipeline" className="gap-1.5"><LayoutGrid className="h-3.5 w-3.5" /> Pipeline</TabsTrigger>
        </TabsList>

        {/* Contacts Tab */}
        <TabsContent value="contacts">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search contacts..."
                value={contactSearch}
                onChange={(e) => handleSearchContacts(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={() => openContactDialog()} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Contact
            </Button>
          </div>

          {loading ? (
            <Card>
              <CardContent className="p-0">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-14 border-b" />
                ))}
              </CardContent>
            </Card>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
                <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchContacts().finally(() => setLoading(false)) }} className="ml-auto">Retry</Button>
              </CardContent>
            </Card>
          ) : filteredContacts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Users className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">{contactSearch ? 'No contacts found' : 'No contacts yet'}</h3>
                <p className="text-sm text-gray-400 mt-1">{contactSearch ? 'Try a different search term' : 'Add your first contact to get started'}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredContacts.map((contact) => (
                        <TableRow key={contact.id}>
                          <TableCell className="font-medium">
                            {contact.firstName} {contact.lastName || ''}
                          </TableCell>
                          <TableCell className="text-gray-500 text-sm">{contact.email || '-'}</TableCell>
                          <TableCell className="text-gray-500 text-sm">{contact.phone || '-'}</TableCell>
                          <TableCell className="text-gray-500 text-sm">{contact.company || '-'}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={contactStatusColor(contact.status)}>
                              {contact.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-gray-500 text-sm capitalize">{contact.source}</TableCell>
                          <TableCell className="text-gray-400 text-sm">
                            {format(new Date(contact.createdAt), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => openContactDialog(contact)}>
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Deals Tab */}
        <TabsContent value="deals">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-500">
                Total Pipeline Value: <span className="font-semibold text-gray-900">${deals.reduce((s, d) => s + d.value, 0).toLocaleString()}</span>
              </span>
            </div>
            <Button onClick={openDealDialog} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Deal
            </Button>
          </div>

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
          ) : deals.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <HandshakeIcon className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No deals yet</h3>
                <p className="text-sm text-gray-400 mt-1">Create your first deal to track your pipeline</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Pipeline</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead>Probability</TableHead>
                        <TableHead>Expected Close</TableHead>
                        <TableHead className="w-20"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deals.map((deal) => (
                        <TableRow key={deal.id}>
                          <TableCell className="font-medium">{deal.title}</TableCell>
                          <TableCell className="text-gray-500 text-sm">
                            {deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName || ''}` : '-'}
                          </TableCell>
                          <TableCell className="font-medium">${deal.value.toLocaleString()}</TableCell>
                          <TableCell className="text-gray-500 text-sm">{deal.pipeline?.name || '-'}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize">
                              {deal.stage}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#E8501A] rounded-full"
                                  style={{ width: `${deal.probability}%` }}
                                />
                              </div>
                              <span className="text-gray-500">{deal.probability}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-gray-400 text-sm">
                            {deal.expectedCloseDate ? format(new Date(deal.expectedCloseDate), 'MMM d, yyyy') : '-'}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm">View</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Pipeline Tab (Kanban) */}
        <TabsContent value="pipeline">
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-[400px] rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="flex items-center gap-3 p-6">
                <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-red-700">{error}</p>
              </CardContent>
            </Card>
          ) : deals.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <LayoutGrid className="h-12 w-12 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-500">No deals in pipeline</h3>
                <p className="text-sm text-gray-400 mt-1">Create deals to see them in the pipeline view</p>
              </CardContent>
            </Card>
          ) : (
            <DndContext
              collisionDetection={closestCenter}
              onDragEnd={async (event: DragEndEvent) => {
                const { active, over } = event
                if (!over || active.id === over.id) return
                const dealId = active.id as string
                const targetStage = over.id as string
                // Optimistically update local state
                setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: targetStage } : d))
                try {
                  const token = getToken()
                  if (!token) return
                  const res = await fetch(`/api/crm/deals/${dealId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ stageId: targetStage }),
                  })
                  if (!res.ok) throw new Error('Failed to update deal stage')
                } catch {
                  // Revert on error
                  const deal = deals.find(d => d.id === dealId)
                  if (deal) {
                    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage: deal.stage } : d))
                  }
                  toast.error('Failed to move deal')
                }
              }}
            >
              <div className="flex gap-4 overflow-x-auto pb-4">
                {pipelineDeals.map((column) => (
                  <DroppableColumn key={column.key} stageKey={column.key} color={column.color}>
                    {/* Column Header */}
                    <div className="p-3 border-b bg-white/80 rounded-t-xl">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-sm">{column.key}</h3>
                        <Badge variant="secondary" className="text-xs">
                          {column.deals.length}
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        ${column.totalValue.toLocaleString()}
                      </p>
                    </div>

                    {/* Column Cards */}
                    <ScrollArea className="flex-1 p-2">
                      <div className="space-y-2 min-h-[100px]">
                        {column.deals.length === 0 ? (
                          <div className="flex items-center justify-center py-8 text-gray-300 text-xs">
                            No deals
                          </div>
                        ) : (
                          column.deals.map((deal) => (
                            <DraggableDealCard key={deal.id} deal={deal} />
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </DroppableColumn>
                ))}
              </div>
            </DndContext>
          )}
        </TabsContent>
      </Tabs>

      {/* Add/Edit Contact Dialog */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingContact ? 'Edit Contact' : 'Add Contact'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input
                  value={contactForm.firstName}
                  onChange={(e) => setContactForm(f => ({ ...f, firstName: e.target.value }))}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input
                  value={contactForm.lastName}
                  onChange={(e) => setContactForm(f => ({ ...f, lastName: e.target.value }))}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={contactForm.email}
                onChange={(e) => setContactForm(f => ({ ...f, email: e.target.value }))}
                placeholder="john@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={contactForm.phone}
                onChange={(e) => setContactForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+1 (555) 123-4567"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Input
                  value={contactForm.company}
                  onChange={(e) => setContactForm(f => ({ ...f, company: e.target.value }))}
                  placeholder="Acme Inc."
                />
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={contactForm.title}
                  onChange={(e) => setContactForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="CEO"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={contactForm.status} onValueChange={(v) => setContactForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTACT_STATUSES.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Source</Label>
                <Select value={contactForm.source} onValueChange={(v) => setContactForm(f => ({ ...f, source: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONTACT_SOURCES.map(s => (
                      <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveContact} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              {editingContact ? 'Save Changes' : 'Create Contact'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Deal Dialog */}
      <Dialog open={dealDialogOpen} onOpenChange={setDealDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Deal</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Deal Title *</Label>
              <Input
                value={dealForm.title}
                onChange={(e) => setDealForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Enterprise License Deal"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Contact</Label>
                <Select value={dealForm.contactId} onValueChange={(v) => setDealForm(f => ({ ...f, contactId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select contact" /></SelectTrigger>
                  <SelectContent>
                    {contacts.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.firstName} {c.lastName || ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Value ($)</Label>
                <Input
                  type="number"
                  value={dealForm.value}
                  onChange={(e) => setDealForm(f => ({ ...f, value: e.target.value }))}
                  placeholder="10000"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pipeline</Label>
                <Select value={dealForm.pipelineId} onValueChange={(v) => setDealForm(f => ({ ...f, pipelineId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select pipeline" /></SelectTrigger>
                  <SelectContent>
                    {pipelines.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Stage</Label>
                <Select value={dealForm.stage} onValueChange={(v) => setDealForm(f => ({ ...f, stage: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map(s => (
                      <SelectItem key={s.key} value={s.key}>{s.key}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Probability (%)</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={dealForm.probability}
                  onChange={(e) => setDealForm(f => ({ ...f, probability: e.target.value }))}
                  placeholder="20"
                />
              </div>
              <div className="space-y-2">
                <Label>Expected Close Date</Label>
                <Input
                  type="date"
                  value={dealForm.expectedCloseDate}
                  onChange={(e) => setDealForm(f => ({ ...f, expectedCloseDate: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDealDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveDeal} className="bg-[#E8501A] hover:bg-[#5B2FC9]">
              Create Deal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}