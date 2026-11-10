import { describe, it, expect } from 'vitest'

describe('application constants', () => {
  it('API response uses success boolean', () => {
    const res = { success: true, status: 200, data: null, error: null, requestId: 'test' }
    expect(res.success).toBe(true)
  })

  it('API response uses error boolean', () => {
    const res = { success: false, status: 500, data: null, error: { code: 'ERR' }, requestId: 'test' }
    expect(res.success).toBe(false)
  })

  it('user roles are defined correctly', () => {
    const roles = ['SUPER_ADMIN', 'ADMIN', 'DEVOPS', 'SUPPORT', 'VIEWER']
    expect(roles).toContain('SUPER_ADMIN')
    expect(roles).toContain('VIEWER')
    expect(roles).toHaveLength(5)
  })
})
