'use client'

import * as React from 'react'
import { Users, Kanban, Activity } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '@/stores/authStore'
import ContactsTab from '@/components/dashboard/crm/ContactsTab'
import PipelineTab from '@/components/dashboard/crm/PipelineTab'
import ActivitiesTab from '@/components/dashboard/crm/ActivitiesTab'

export default function CrmPage() {
  const token = useAuthStore((s) => s.token)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const [contactCount, setContactCount] = React.useState(0)
  const [dealCount, setDealCount] = React.useState(0)
  const [activityCount, setActivityCount] = React.useState(0)

  React.useEffect(() => {
    if (!isAuthenticated || !token) return
    let cancelled = false
    ;(async () => {
      try {
        const [contactsRes, dealsRes, activitiesRes] = await Promise.all([
          fetch('/api/crm/contacts', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/crm/deals', { headers: { Authorization: `Bearer ${token}` } }),
          fetch('/api/crm/activities', { headers: { Authorization: `Bearer ${token}` } }),
        ])
        if (!cancelled && contactsRes.ok) {
          const data = await contactsRes.json()
          setContactCount(data.total || 0)
        }
        if (!cancelled && dealsRes.ok) {
          const data = await dealsRes.json()
          setDealCount(data.deals?.length || 0)
        }
        if (!cancelled && activitiesRes.ok) {
          const data = await activitiesRes.json()
          setActivityCount(data.activities?.length || 0)
        }
      } catch {
        // Non-critical
      }
    })()
    return () => { cancelled = true }
  }, [isAuthenticated, token])

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-[#475569]">Please sign in to access CRM.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1E293B]">CRM</h1>
        <p className="text-[#475569] mt-1">Manage your contacts, deals pipeline, and activities</p>
      </div>

      <Tabs defaultValue="contacts" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="contacts" className="gap-1.5">
            <Users className="size-4" />
            Contacts
            <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
              {contactCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="pipeline" className="gap-1.5">
            <Kanban className="size-4" />
            Pipeline
            <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
              {dealCount}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="activities" className="gap-1.5">
            <Activity className="size-4" />
            Activities
            <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
              {activityCount}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contacts">
          <ContactsTab />
        </TabsContent>

        <TabsContent value="pipeline">
          <PipelineTab />
        </TabsContent>

        <TabsContent value="activities">
          <ActivitiesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}