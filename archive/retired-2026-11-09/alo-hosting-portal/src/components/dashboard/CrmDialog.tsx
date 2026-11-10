'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface CrmDialogField {
  name: string
  label: string
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'date'
  placeholder?: string
  required?: boolean
  options?: { label: string; value: string }[]
  defaultValue?: string | number
}

interface CrmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  fields: CrmDialogField[]
  submitLabel?: string
  onSubmit: (values: Record<string, string | number>) => void | Promise<void>
  loading?: boolean
}

export default function CrmDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  submitLabel = 'Save',
  onSubmit,
  loading = false,
}: CrmDialogProps) {
  const [values, setValues] = React.useState<Record<string, string | number>>({})

  React.useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        const initial: Record<string, string | number> = {}
        fields.forEach((f) => {
          initial[f.name] = f.defaultValue ?? ''
        })
        setValues(initial)
      })
    }
  }, [open, fields])

  const handleChange = (name: string, value: string | number) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(values)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {fields.map((field) => (
              <div key={field.name} className="grid gap-2">
                <Label htmlFor={field.name}>
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
                {field.type === 'select' ? (
                  <Select
                    value={String(values[field.name] ?? '')}
                    onValueChange={(v) => handleChange(field.name, v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={field.placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === 'textarea' ? (
                  <Textarea
                    id={field.name}
                    placeholder={field.placeholder}
                    value={String(values[field.name] ?? '')}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    rows={3}
                  />
                ) : (
                  <Input
                    id={field.name}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={values[field.name] ?? ''}
                    onChange={(e) =>
                      handleChange(
                        field.name,
                        field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value
                      )
                    }
                    required={field.required}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}