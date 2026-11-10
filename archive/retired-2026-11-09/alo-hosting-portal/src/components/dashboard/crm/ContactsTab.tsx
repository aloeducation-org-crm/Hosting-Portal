'use client'

import * as React from 'react'
import { format } from 'date-fns'
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
  Phone,
  Mail,
  Building2,
  Briefcase,
  StickyNote,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'
import CrmDialog, { type CrmDialogField } from '@/components/dashboard/CrmDialog'

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
  notes: string
  createdAt: string
  deals?: Deal[]
  activities?: Activity[]
}

interface Deal {
  id: string
  title: string
  value: number
  currency: string
  stage: string
  probability: number
  createdAt: string
}

interface Activity {
  id: string
  type: string
  subject: string
  description: string | null
  completed: boolean
  createdAt: string
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  lead: 'outline',
  prospect: 'secondary',
  customer: 'default',
  churned: 'destructive',
}

const STATUS_COLOR: Record<string, string> = {
  lead: 'bg-amber-50 text-amber-700 border-amber-200',
  prospect: 'bg-blue-50 text-blue-700 border-blue-200',
  customer: 'bg-green-50 text-green-700 border-green-200',
  churned: 'bg-red-50 text-red-700 border-red-200',
}

const ACTIVITY_ICON: Record<string, string> = {
  call: '📞',
  email: '✉️',
  meeting: '🤝',
  note: '📝',
  task: '✅',
}

export default function ContactsTab() {
  const token = useAuthStore((s) => s.token)
  const [contacts, setContacts] = React.useState<Contact[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState('')

  // Dialog states
  const [addOpen, setAddOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editingContact, setEditingContact] = React.useState<Contact | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  // Detail panel
  const [selectedContactId, setSelectedContactId] = React.useState<string | null>(null)
  const [contactDetail, setContactDetail] = React.useState<Contact | null>(null)
  const [detailLoading, setDetailLoading] = React.useState(false)
  const [newNote, setNewNote] = React.useState('')
  const [addingNote, setAddingNote] = React.useState(false)

  const fetchContactDetail = async (id: string) => {
    if (!token) return
    setDetailLoading(true)
    setSelectedContactId(id)
    try {
      const res = await fetch(`/api/crm/contacts/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setContactDetail(data.contact)
    } catch {
      toast.error('Failed to load contact details')
    } finally {
      setDetailLoading(false)
    }
  }

  const refreshContacts = async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      const res = await fetch(`/api/crm/contacts?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setContacts(data.contacts)
    } catch {
      // Non-critical on refresh
    }
  }

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) return
      try {
        const params = new URLSearchParams()
        if (search) params.set('search', search)
        if (statusFilter) params.set('status', statusFilter)
        const res = await fetch(`/api/crm/contacts?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch')
        const data = await res.json()
        if (!cancelled) {
          setContacts(data.contacts)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          toast.error('Failed to load contacts')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [token, search, statusFilter])

  const handleAddContact = async (values: Record<string, string | number>) => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/crm/contacts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create')
      }
      toast.success('Contact created')
      setAddOpen(false)
      refreshContacts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create contact')
    } finally {
      setSubmitting(false)
    }
  }

  const handleEditContact = async (values: Record<string, string | number>) => {
    if (!editingContact) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/crm/contacts/${editingContact.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update')
      }
      toast.success('Contact updated')
      setEditOpen(false)
      setEditingContact(null)
      refreshContacts()
      if (selectedContactId === editingContact.id) {
        fetchContactDetail(editingContact.id)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update contact')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteContact = async () => {
    if (!deletingId) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/crm/contacts/${deletingId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to delete')
      toast.success('Contact deleted')
      setDeleteOpen(false)
      setDeletingId(null)
      setSelectedContactId(null)
      setContactDetail(null)
      refreshContacts()
    } catch {
      toast.error('Failed to delete contact')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddNote = async () => {
    if (!contactDetail || !newNote.trim() || !token) return
    setAddingNote(true)
    try {
      const notes = JSON.parse(contactDetail.notes || '[]')
      notes.push({ text: newNote.trim(), createdAt: new Date().toISOString() })
      const res = await fetch(`/api/crm/contacts/${contactDetail.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notes: JSON.stringify(notes) }),
      })
      if (!res.ok) throw new Error('Failed to add note')
      toast.success('Note added')
      setNewNote('')
      fetchContactDetail(contactDetail.id)
    } catch {
      toast.error('Failed to add note')
    } finally {
      setAddingNote(false)
    }
  }

  const contactFields: CrmDialogField[] = [
    { name: 'firstName', label: 'First Name', type: 'text', required: true, placeholder: 'John' },
    { name: 'lastName', label: 'Last Name', type: 'text', placeholder: 'Doe' },
    { name: 'email', label: 'Email', type: 'email', placeholder: 'john@example.com' },
    { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+1 234 567 890' },
    { name: 'company', label: 'Company', type: 'text', placeholder: 'Acme Inc.' },
    { name: 'title', label: 'Job Title', type: 'text', placeholder: 'CEO' },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      defaultValue: 'lead',
      options: [
        { label: 'Lead', value: 'lead' },
        { label: 'Prospect', value: 'prospect' },
        { label: 'Customer', value: 'customer' },
        { label: 'Churned', value: 'churned' },
      ],
    },
    {
      name: 'source',
      label: 'Source',
      type: 'select',
      defaultValue: 'manual',
      options: [
        { label: 'Manual', value: 'manual' },
        { label: 'Import', value: 'import' },
        { label: 'Form', value: 'form' },
        { label: 'Referral', value: 'referral' },
      ],
    },
  ]

  const editFields: CrmDialogField[] = editingContact
    ? contactFields.map((f) => ({
        ...f,
        defaultValue:
          editingContact[f.name as keyof Contact] as string | number | undefined,
      }))
    : []

  const parsedNotes: { text: string; createdAt: string }[] = contactDetail
    ? JSON.parse(contactDetail.notes || '[]')
    : []

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center flex-1 w-full sm:w-auto">
          <div className="relative flex-1 w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search contacts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="prospect">Prospect</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="churned">Churned</SelectItem>
            </SelectContent>
          </Select>
          {(search || statusFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('')
                setStatusFilter('')
              }}
            >
              <X className="size-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
        <Button onClick={() => setAddOpen(true)} className="w-full sm:w-auto">
          <Plus className="size-4 mr-2" />
          Add Contact
        </Button>
      </div>

      {/* Table + Detail Panel */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg font-medium">No contacts found</p>
              <p className="text-sm mt-1">Add your first contact to get started</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead className="hidden sm:table-cell">Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Source</TableHead>
                    <TableHead className="hidden lg:table-cell">Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => (
                    <TableRow
                      key={contact.id}
                      className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                        selectedContactId === contact.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                      }`}
                      onClick={() => fetchContactDetail(contact.id)}
                    >
                      <TableCell className="font-medium">
                        {contact.firstName} {contact.lastName || ''}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground text-sm">
                        {contact.email || '—'}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                        {contact.company || '—'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                            STATUS_COLOR[contact.status] || ''
                          }`}
                        >
                          {contact.status.charAt(0).toUpperCase() + contact.status.slice(1)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-sm capitalize">
                        {contact.source}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                        {format(new Date(contact.createdAt), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingContact(contact)
                              setEditOpen(true)
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500 hover:text-red-600"
                            onClick={() => {
                              setDeletingId(contact.id)
                              setDeleteOpen(true)
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedContactId && (
          <div className="w-full lg:w-96 border rounded-lg bg-card flex-shrink-0">
            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : contactDetail ? (
              <ScrollArea className="h-[600px]">
                <div className="p-4 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold">
                        {contactDetail.firstName} {contactDetail.lastName || ''}
                      </h3>
                      {contactDetail.title && (
                        <p className="text-sm text-muted-foreground">{contactDetail.title}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedContactId(null)
                        setContactDetail(null)
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>

                  {/* Info Grid */}
                  <div className="grid gap-3">
                    {contactDetail.email && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="size-4 text-muted-foreground" />
                        <a href={`mailto:${contactDetail.email}`} className="text-primary hover:underline">
                          {contactDetail.email}
                        </a>
                      </div>
                    )}
                    {contactDetail.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="size-4 text-muted-foreground" />
                        <span>{contactDetail.phone}</span>
                      </div>
                    )}
                    {contactDetail.company && (
                      <div className="flex items-center gap-2 text-sm">
                        <Building2 className="size-4 text-muted-foreground" />
                        <span>{contactDetail.company}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm">
                      <Briefcase className="size-4 text-muted-foreground" />
                      <span className="capitalize">{contactDetail.status}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground capitalize">{contactDetail.source}</span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold flex items-center gap-1">
                      <StickyNote className="size-4" /> Notes
                    </h4>
                    {parsedNotes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No notes yet</p>
                    ) : (
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {parsedNotes.map((note, i) => (
                          <div key={i} className="bg-muted/50 rounded-md p-2 text-sm">
                            <p>{note.text}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(note.createdAt), 'MMM d, yyyy h:mm a')}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input
                        placeholder="Add a note..."
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                      />
                      <Button
                        size="sm"
                        onClick={handleAddNote}
                        disabled={addingNote || !newNote.trim()}
                      >
                        {addingNote ? <Loader2 className="size-4 animate-spin" /> : 'Add'}
                      </Button>
                    </div>
                  </div>

                  {/* Related Deals */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">
                      Deals ({contactDetail.deals?.length || 0})
                    </h4>
                    {(!contactDetail.deals || contactDetail.deals.length === 0) ? (
                      <p className="text-sm text-muted-foreground">No deals</p>
                    ) : (
                      <div className="space-y-1.5 max-h-32 overflow-y-auto">
                        {contactDetail.deals.map((deal) => (
                          <div
                            key={deal.id}
                            className="flex items-center justify-between bg-muted/50 rounded-md p-2 text-sm"
                          >
                            <span className="font-medium truncate mr-2">{deal.title}</span>
                            <span className="text-primary font-semibold whitespace-nowrap">
                              ${deal.value.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Activity Timeline */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">
                      Activities ({contactDetail.activities?.length || 0})
                    </h4>
                    {(!contactDetail.activities || contactDetail.activities.length === 0) ? (
                      <p className="text-sm text-muted-foreground">No activities</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {contactDetail.activities.slice(0, 10).map((act) => (
                          <div
                            key={act.id}
                            className="flex gap-2 items-start text-sm"
                          >
                            <span className="text-base mt-0.5">
                              {ACTIVITY_ICON[act.type] || '📌'}
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{act.subject}</p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(act.createdAt), 'MMM d, yyyy h:mm a')}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            ) : null}
          </div>
        )}
      </div>

      {/* Add Dialog */}
      <CrmDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add Contact"
        description="Create a new CRM contact"
        fields={contactFields}
        onSubmit={handleAddContact}
        loading={submitting}
      />

      {/* Edit Dialog */}
      <CrmDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit Contact"
        description={`Editing ${editingContact?.firstName || ''}`}
        fields={editFields}
        onSubmit={handleEditContact}
        loading={submitting}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>
              This will permanently delete this contact, their deals, and activities. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteContact}
              disabled={submitting}
            >
              {submitting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}