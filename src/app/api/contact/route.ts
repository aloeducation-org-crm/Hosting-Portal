import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

const contactSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please provide a valid email address'),
  subject: z.string().optional(),
  message: z.string().min(10, 'Message must be at least 10 characters'),
  // Software Factory funnel fields (all optional — preserves existing callers).
  source: z.string().max(64).optional(),
  industry: z
    .string()
    .max(64)
    .regex(/^[a-z0-9-]*$/, 'industry must be a slug')
    .optional(),
  service: z
    .string()
    .max(64)
    .regex(/^[a-z0-9-]*$/, 'service must be a slug')
    .optional(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const parsed = contactSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { name, email, subject, message, source, industry, service } = parsed.data

    // 1. The durable enquiry record (raw intake, survives any CRM issue).
    const contact = await db.contact.create({
      data: {
        name,
        email,
        subject: subject ?? null,
        message,
        source: source ?? 'website-form',
        industry: industry || null,
        service: service || null,
        status: 'new',
      },
    })

    // 2. Enter the Client CRM as a lead (SUPER_ADMIN-visible, unassigned).
    //    Careful dedup: one unassigned lead per email — existing leads are
    //    never merged or rewritten by a new enquiry.
    try {
      const existing = await db.crmContact.findFirst({
        where: { email, userId: null },
        select: { id: true },
      })
      if (!existing) {
        const parts = name.trim().split(/\s+/)
        const firstName = parts[0] ?? name.trim()
        const lastName = parts.slice(1).join(' ') || null
        const notesParts = [`Source: ${source ?? 'website-form'}`]
        if (industry) notesParts.push(`Industry: ${industry}`)
        if (service) notesParts.push(`Service: ${service}`)
        if (subject) notesParts.push(`Subject: ${subject}`)
        notesParts.push(`Message: ${message}`)
        await db.crmContact.create({
          data: {
            firstName,
            lastName,
            email,
            status: 'lead',
            source: source ?? 'website-form',
            notes: notesParts.join('\n'),
            userId: null,
          },
        })
      }
    } catch (crmError) {
      // The enquiry itself succeeded; surface the CRM failure in logs only —
      // staff still have the contact row with status "new" to work from.
      console.error('CRM lead creation failed for contact', contact.id, crmError)
    }

    return NextResponse.json({ success: true, id: contact.id })
  } catch (error) {
    console.error('Contact form error:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
