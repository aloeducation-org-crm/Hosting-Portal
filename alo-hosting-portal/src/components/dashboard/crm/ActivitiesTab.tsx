'use client'

import * as React from 'react'
import { format, isPast, isToday } from 'date-fns'
import {
  Plus,
  Phone,
  Mail,
  Users,
  FileText,
  CheckSquare,
  AlertTriangle,
  Loader2,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'
import CrmDialog, { type CrmDialogField } from '@/components/dashboard/CrmDialog'

interface Activity {
  id: string
  type: string
  subject: string
  description: string | null
  completed: boolean
  dueDate: string | null
  createdAt: string
  contact?: { id: string; firstName: string; lastName: string | null } | null
  deal?: { id: string; title: string } | null
}

interface ContactOption {
  id: string
  firstName: string
  lastName: string | null
}

interface DealOption {
  id: string
  title: string
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string }> = {
  call: {
    icon: <Phone className="size-4" />,
    color: 'text-green-600',
    bgColor: 'bg-green-50 border-green-200',
  },
  email: {
    icon: <Mail className="size-4" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200',
  },
  meeting: {
    icon: <Users className="size-4" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 border-purple-200',
  },
  note: {
    icon: <FileText className="size-4" />,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 border-amber-200',
  },
  task: {
    icon: <CheckSquare className="size-4" />,
    color: 'text-primary',
    bgColor: 'bg-primary/5 border-primary/20',
  },
}

export default function ActivitiesTab() {
  const token = useAuthStore((s) => s.token)
  const [activities, setActivities] = React.useState<Activity[]>([])
  const [loading, setLoading] = React.useState(true)
  const [typeFilter, setTypeFilter] = React.useState('')

  const [addOpen, setAddOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [contacts, setContacts] = React.useState<ContactOption[]>([])
  const [deals, setDeals] = React.useState<DealOption[]>([])

  const loadActivities = async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter)
      const res = await fetch(`/api/crm/activities?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setActivities(data.activities)
    } catch {
      toast.error('Failed to load activities')
    }
  }

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) return
      try {
        const params = new URLSearchParams()
        if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter)
        const res = await fetch(`/api/crm/activities?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        if (!cancelled) {
          setActivities(data.activities)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [token, typeFilter])

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) return
      try {
        const [contactsRes, dealsRes] = await Promise.all([
          fetch('/api/crm/contacts', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/crm/deals', { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (contactsRes.ok) {
          const data = await contactsRes.json()
          if (!cancelled) setContacts(data.contacts || [])
        }
        if (dealsRes.ok) {
          const data = await dealsRes.json()
          if (!cancelled) setDeals(data.deals || [])
        }
      } catch {
        // Non-critical
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleToggleComplete = async (activity: Activity) => {
    try {
      const res = await fetch(`/api/crm/activities/${activity.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ completed: !activity.completed }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setActivities((prev) =>
        prev.map((a) => (a.id === activity.id ? { ...a, completed: !a.completed } : a))
      )
      toast.success(activity.completed ? 'Marked as incomplete' : 'Task completed')
    } catch {
      toast.error('Failed to update activity')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/crm/activities/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to delete')
      setActivities((prev) => prev.filter((a) => a.id !== id))
      toast.success('Activity deleted')
    } catch {
      toast.error('Failed to delete activity')
    }
  }

  const handleAddActivity = async (values: Record<string, string | number>) => {
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = { ...values }
      if (!body.contactId) delete body.contactId
      if (!body.dealId) delete body.dealId
      if (!body.dueDate) delete body.dueDate

      const res = await fetch('/api/crm/activities', {
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
      toast.success('Activity logged')
      setAddOpen(false)
      loadActivities()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log activity')
    } finally {
      setSubmitting(false)
    }
  }

  const activityFields: CrmDialogField[] = [
    {
      name: 'type',
      label: 'Type',
      type: 'select',
      required: true,
      defaultValue: 'note',
      options: [
        { label: '📞 Call', value: 'call' },
        { label: '✉️ Email', value: 'email' },
        { label: '🤝 Meeting', value: 'meeting' },
        { label: '📝 Note', value: 'note' },
        { label: '✅ Task', value: 'task' },
      ],
    },
    { name: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'Follow up call' },
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Details about this activity...' },
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
    {
      name: 'dealId',
      label: 'Deal',
      type: 'select',
      options: [
        { label: '— None —', value: '' },
        ...deals.map((d) => ({ label: d.title, value: d.id })),
      ],
    },
    { name: 'dueDate', label: 'Due Date', type: 'date' },
  ]

  const isOverdue = (dueDate: string | null, completed: boolean) => {
    if (!dueDate || completed) return false
    return isPast(new Date(dueDate)) && !isToday(new Date(dueDate))
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 items-center w-full sm:w-auto">
          <Select value={typeFilter || 'all'} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="call">📞 Call</SelectItem>
              <SelectItem value="email">✉️ Email</SelectItem>
              <SelectItem value="meeting">🤝 Meeting</SelectItem>
              <SelectItem value="note">📝 Note</SelectItem>
              <SelectItem value="task">✅ Task</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setAddOpen(true)} className="w-full sm:w-auto">
          <Plus className="size-4 mr-2" />
          Log Activity
        </Button>
      </div>

      {/* Activity List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium">No activities yet</p>
          <p className="text-sm mt-1">Log your first activity to get started</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {activities.map((activity) => {
            const config = (TYPE_CONFIG[activity.type] || TYPE_CONFIG.note)!
            const overdue = isOverdue(activity.dueDate, activity.completed)

            return (
              <div
                key={activity.id}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/30 ${
                  activity.completed ? 'opacity-60' : ''
                } ${overdue ? 'border-red-200 bg-red-50/50' : ''} ${
                  !overdue && !activity.completed ? 'border-border bg-card' : ''
                }`}
              >
                {/* Checkbox for tasks */}
                <div className="pt-0.5">
                  {activity.type === 'task' ? (
                    <Checkbox
                      checked={activity.completed}
                      onCheckedChange={() => handleToggleComplete(activity)}
                    />
                  ) : (
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center ${config.bgColor} ${config.color}`}
                    >
                      {config.icon}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p
                        className={`font-medium text-sm ${
                          activity.completed ? 'line-through text-muted-foreground' : ''
                        }`}
                      >
                        {activity.subject}
                      </p>
                      {activity.description && (
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                          {activity.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-red-500 flex-shrink-0 h-8 w-8 p-0"
                      onClick={() => handleDelete(activity.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>

                  {/* Meta */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                    <span className="capitalize font-medium">{activity.type}</span>
                    <span>·</span>
                    <span>{format(new Date(activity.createdAt), 'MMM d, yyyy h:mm a')}</span>
                    {activity.contact && (
                      <>
                        <span>·</span>
                        <span>
                          {activity.contact.firstName} {activity.contact.lastName || ''}
                        </span>
                      </>
                    )}
                    {activity.deal && (
                      <>
                        <span>·</span>
                        <span className="text-primary">{activity.deal.title}</span>
                      </>
                    )}
                    {activity.dueDate && (
                      <>
                        <span>·</span>
                        <span className={overdue ? 'text-red-600 font-semibold' : ''}>
                          Due: {format(new Date(activity.dueDate), 'MMM d, yyyy')}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Overdue Warning */}
                  {overdue && (
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-red-600 font-medium">
                      <AlertTriangle className="size-3" />
                      Overdue
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add Activity Dialog */}
      <CrmDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Log Activity"
        description="Record a new CRM activity"
        fields={activityFields}
        onSubmit={handleAddActivity}
        loading={submitting}
      />
    </div>
  )
}