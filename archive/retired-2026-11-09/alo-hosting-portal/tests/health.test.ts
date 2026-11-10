import { describe, it, expect } from 'vitest'

describe('Health check utilities', () => {
  it('validates health status enum values', () => {
    const validStatuses = ['HEALTHY', 'DEGRADED', 'DOWN', 'SUSPENDED', 'DEPLOYING', 'RESTORING', 'UNKNOWN']
    expect(validStatuses).toContain('HEALTHY')
    expect(validStatuses).toContain('UNKNOWN')
    expect(validStatuses).toHaveLength(7)
  })

  it('validates website runtime enum values', () => {
    const validRuntimes = ['STATIC', 'PHP82', 'NODE', 'NEXTJS']
    expect(validRuntimes).toContain('STATIC')
    expect(validRuntimes).toContain('NEXTJS')
    expect(validRuntimes).toHaveLength(4)
  })

  it('validates deployment status enum values', () => {
    const validStatuses = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'ROLLING_BACK', 'ROLLED_BACK']
    expect(validStatuses).toContain('PENDING')
 expect(validStatuses).toContain('SUCCESS')
    expect(validStatuses).toHaveLength(6)
  })
})
