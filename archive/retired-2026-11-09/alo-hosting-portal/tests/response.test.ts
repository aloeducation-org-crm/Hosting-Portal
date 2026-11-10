import { describe, it, expect } from 'vitest'
import { apiSuccess, apiError, type ApiResponse } from '../src/lib/response'

describe('apiSuccess', () => {
  it('returns a success response with default values', () => {
    const result = apiSuccess({ items: [1, 2, 3] })
    expect(result.success).toBe(true)
    expect(result.status).toBe(200)
    expect(result.message).toBe('Success')
    expect(result.error).toBeNull()
    expect(result.requestId).toBeDefined()
    expect((result.data as { items: number[] }).items).toEqual([1, 2, 3])
  })

  it('accepts custom message and status', () => {
    const result = apiSuccess({ ok: true }, 'Created', 201)
    expect(result.success).toBe(true)
    expect(result.status).toBe(201)
    expect(result.message).toBe('Created')
    expect((result.data as { ok: boolean }).ok).toBe(true)
  })

  it('handles null data', () => {
    const result = apiSuccess()
    expect(result.success).toBe(true)
    expect(result.data).toBeNull()
  })

  it('generates unique requestIds', () => {
    const r1 = apiSuccess(null)
    const r2 = apiSuccess(null)
    expect(r1.requestId).not.toBe(r2.requestId)
  })
})

describe('apiError', () => {
  it('returns an error response with default values', () => {
    const result = apiError('Something went wrong')
    expect(result.success).toBe(false)
    expect(result.status).toBe(500)
    expect(result.message).toBe('Something went wrong')
    expect(result.data).toBeNull()
    expect(result.error).toBeDefined()
    expect(result.error.code).toBe('INTERNAL_ERROR')
  })

  it('accepts custom code, details, and status', () => {
    const result = apiError('Not found', 'NOT_FOUND', { field: 'id' }, 404)
    expect(result.success).toBe(false)
    expect(result.status).toBe(404)
    expect(result.message).toBe('Not found')
    expect(result.error.code).toBe('NOT_FOUND')
    expect((result.error.details as { field: string }).field).toBe('id')
  })

  it('includes requestId', () => {
    const result = apiError('Fail')
    expect(result.requestId).toBeDefined()
  })
})

describe('ApiResponse type', () => {
  it('can be typed as ApiSuccessResponse', () => {
    const r: ApiResponse<string> = apiSuccess('hello')
    if (r.success) {
      expect(typeof r.data).toBe('string')
    }
  })
})
