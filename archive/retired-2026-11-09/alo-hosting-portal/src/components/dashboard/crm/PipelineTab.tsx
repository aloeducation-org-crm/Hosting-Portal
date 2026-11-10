'use client'

import * as React from 'react'
import { Plus, Loader2, DollarSign, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'
import CrmDialog, { type CrmDialogField } from '@/components/dashboard/CrmDialog'
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Deal {
  id: string
  title: string
  value: number
  currency: string
  stage: string
  probability: number
  createdAt: string
  contact?: { id: string; firstName: string; lastName: string | null; email: string | null; company: string | null } | null
  pipeline?: { id: string; name: string } | null
}

interface Pipeline {
  id: string
  name: string
  stages: string
  isDefault: boolean
}

const DEFAULT_STAGES = ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']

const STAGE_STYLES: Record<string, string> = {
  Won: 'bg-green-50 border-green-200',
  Lost: 'bg-red-50 border-red-200',
  Lead: 'bg-amber-50 border-amber-200',
  Qualified: 'bg-blue-50 border-blue-200',
  Proposal: 'bg-purple-50 border-purple-200',
  Negotiation: 'bg-orange-50 border-orange-200',
}

const STAGE_HEADER: Record<string, string> = {
  Won: 'bg-green-500',
  Lost: 'bg-red-500',
  Lead: 'bg-amber-500',
  Qualified: 'bg-blue-500',
  Proposal: 'bg-purple-500',
  Negotiation: 'bg-orange-500',
}

function SortableDealCard({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { deal },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="cursor-grab active:cursor-grabbing mb-2 hover:shadow-md transition-shadow"
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <button
            {...attributes}
            {...listeners}
            className="mt-0.5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">{deal.title}</p>
            {deal.contact && (
              <p className="text-xs text-muted-foreground truncate">
                {deal.contact.firstName} {deal.contact.lastName || ''}
                {deal.contact.company ? ` · ${deal.contact.company}` : ''}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between pl-6">
          <span className="text-sm font-semibold text-primary">
            ${deal.value.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {deal.probability}%
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

export default function PipelineTab() {
  const token = useAuthStore((s) => s.token)
  const [deals, setDeals] = React.useState<Deal[]>([])
  const [pipeline, setPipeline] = React.useState<Pipeline | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [totalValue, setTotalValue] = React.useState(0)
  const [activeId, setActiveId] = React.useState<string | null>(null)

  const [addDealOpen, setAddDealOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [contacts, setContacts] = React.useState<{ id: string; firstName: string; lastName: string | null }[]>([])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const stages = React.useMemo(() => {
    if (pipeline?.stages) {
      return pipeline.stages.split(',').map((s) => s.trim()).filter(Boolean)
    }
    return DEFAULT_STAGES
  }, [pipeline])

  const dealsByStage = React.useMemo(() => {
    const map: Record<string, Deal[]> = {}
    stages.forEach((s) => {
      map[s] = deals.filter((d) => d.stage === s)
    })
    return map
  }, [deals, stages])

  const stageValue = React.useMemo(() => {
    const map: Record<string, number> = {}
    stages.forEach((s) => {
      map[s] = deals
        .filter((d) => d.stage === s)
        .reduce((sum, d) => sum + d.value, 0)
    })
    return map
  }, [deals, stages])

  const fetchData = async () => {
    if (!token) return
    try {
      const [dealsRes, pipelinesRes, contactsRes] = await Promise.all([
        fetch('/api/crm/deals', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/crm/pipelines', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/crm/contacts', { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!dealsRes.ok || !pipelinesRes.ok || !contactsRes.ok) throw new Error('Failed to fetch')
      const dealsData = await dealsRes.json()
      const pipelinesData = await pipelinesRes.json()
      const contactsData = await contactsRes.json()
      setDeals(dealsData.deals)
      setTotalValue(dealsData.totalValue)
      setContacts(contactsData.contacts || [])
      const defaultPipeline = pipelinesData.pipelines.find((p: Pipeline) => p.isDefault)
      if (defaultPipeline) {
        setPipeline(defaultPipeline)
      } else if (pipelinesData.pipelines.length > 0) {
        setPipeline(pipelinesData.pipelines[0])
      }
    } catch {
      toast.error('Failed to load pipeline data')
    }
  }

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) return
      try {
        const [dealsRes, pipelinesRes, contactsRes] = await Promise.all([
          fetch('/api/crm/deals', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/crm/pipelines', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/crm/contacts', { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (!dealsRes.ok || !pipelinesRes.ok || !contactsRes.ok) throw new Error('Failed to fetch')
        const dealsData = await dealsRes.json()
        const pipelinesData = await pipelinesRes.json()
        const contactsData = await contactsRes.json()
        if (!cancelled) {
          setDeals(dealsData.deals)
          setTotalValue(dealsData.totalValue)
          setContacts(contactsData.contacts || [])
          const defaultPipeline = pipelinesData.pipelines.find((p: Pipeline) => p.isDefault)
          if (defaultPipeline) {
            setPipeline(defaultPipeline)
          } else if (pipelinesData.pipelines.length > 0) {
            setPipeline(pipelinesData.pipelines[0])
          }
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          toast.error('Failed to load pipeline data')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)

    if (!over || active.id === over.id) return

    const dealId = String(active.id)
    const overStage = stages.find((s) => s === String(over.id))

    if (!overStage) {
      // Dropped on a deal card - find its stage
      const overDeal = deals.find((d) => d.id === String(over.id))
      if (overDeal) {
        await moveDealToStage(dealId, overDeal.stage)
      }
      return
    }

    await moveDealToStage(dealId, overStage)
  }

  const moveDealToStage = async (dealId: string, newStage: string) => {
    const deal = deals.find((d) => d.id === dealId)
    if (!deal || deal.stage === newStage) return

    // Optimistic update
    setDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, stage: newStage } : d))
    )

    try {
      const res = await fetch(`/api/crm/deals/${dealId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stage: newStage }),
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success(`Moved to ${newStage}`)
      fetchData()
    } catch {
      // Revert on error
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage: deal.stage } : d))
      )
      toast.error('Failed to move deal')
    }
  }

  const handleAddDeal = async (values: Record<string, string | number>) => {
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { ...values }
      if (pipeline) {
        body.pipelineId = pipeline.id
      }
      const res = await fetch('/api/crm/deals', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create')
      }
      toast.success('Deal created')
      setAddDealOpen(false)
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create deal')
    } finally {
      setSubmitting(false)
    }
  }

  const activeDeal = React.useMemo(
    () => (activeId ? deals.find((d) => d.id === activeId) : null),
    [activeId, deals]
  )

  const dealFields: CrmDialogField[] = [
    { name: 'title', label: 'Deal Title', type: 'text', required: true, placeholder: 'Enterprise Plan' },
    { name: 'value', label: 'Value ($)', type: 'number', placeholder: '10000' },
    {
      name: 'stage',
      label: 'Stage',
      type: 'select',
      defaultValue: 'Lead',
      options: stages.map((s) => ({ label: s, value: s })),
    },
    { name: 'probability', label: 'Probability (%)', type: 'number', placeholder: '20' },
    { name: 'expectedCloseDate', label: 'Expected Close Date', type: 'date' },
    {
      name: 'contactId',
      label: 'Contact',
      type: 'select',
      options: [
        { label: '— None —', value: '' },
        ...contacts.map((c) => ({
          label: `${c.firstName} ${c.lastName || ''}`,
          value: c.id,
        })),
      ],
    },
    { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Deal notes...' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-2xl font-bold">Pipeline</h3>
          <p className="text-muted-foreground text-sm">
            Total Pipeline Value:{' '}
            <span className="font-semibold text-primary">${totalValue.toLocaleString()}</span>
          </p>
        </div>
        <Button onClick={() => setAddDealOpen(true)} className="w-full sm:w-auto">
          <Plus className="size-4 mr-2" />
          Add Deal
        </Button>
      </div>

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 500 }}>
          {stages.map((stage) => (
            <div
              key={stage}
              className={`flex-shrink-0 w-72 rounded-lg border p-3 ${STAGE_STYLES[stage] || 'bg-card'}`}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${STAGE_HEADER[stage] || 'bg-gray-400'}`}
                  />
                  <h4 className="font-semibold text-sm">{stage}</h4>
                  <Badge variant="secondary" className="text-xs">
                    {dealsByStage[stage]?.length || 0}
                  </Badge>
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  ${(stageValue[stage] || 0).toLocaleString()}
                </span>
              </div>

              {/* Cards */}
              <SortableContext
                items={(dealsByStage[stage] || []).map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0 min-h-[100px]">
                  {(dealsByStage[stage] || []).length === 0 ? (
                    <div className="border-2 border-dashed border-muted-foreground/20 rounded-lg p-6 text-center">
                      <p className="text-xs text-muted-foreground">No deals</p>
                    </div>
                  ) : (
                    (dealsByStage[stage] || []).map((deal) => (
                      <SortableDealCard key={deal.id} deal={deal} />
                    ))
                  )}
                </div>
              </SortableContext>

              {/* Stage drop zone */}
              <SortableContext items={[`stage-${stage}`]} strategy={verticalListSortingStrategy}>
                <div
                  className={`mt-2 h-8 rounded-lg border-2 border-dashed transition-colors ${
                    stage === 'Won'
                      ? 'border-green-300 hover:border-green-400 hover:bg-green-50/50'
                      : stage === 'Lost'
                      ? 'border-red-300 hover:border-red-400 hover:bg-red-50/50'
                      : 'border-muted-foreground/20 hover:border-primary/30 hover:bg-primary/5'
                  }`}
                  data-stage={stage}
                />
              </SortableContext>
            </div>
          ))}
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeDeal ? (
            <Card className="w-64 shadow-xl rotate-3">
              <CardContent className="p-3 space-y-2">
                <p className="font-medium text-sm">{activeDeal.title}</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-primary">
                    ${activeDeal.value.toLocaleString()}
                  </span>
                  <span className="text-xs bg-muted rounded-full px-2 py-0.5">
                    {activeDeal.probability}%
                  </span>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Add Deal Dialog */}
      <CrmDialog
        open={addDealOpen}
        onOpenChange={setAddDealOpen}
        title="Add Deal"
        description="Create a new pipeline deal"
        fields={dealFields}
        onSubmit={handleAddDeal}
        loading={submitting}
      />
    </div>
  )
}