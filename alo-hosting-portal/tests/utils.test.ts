import { describe, it, expect } from 'vitest';

describe('cn()', () => {
  it('merges class names correctly', async () => {
    const { cn } = await import('../src/lib/utils');
    const result = cn('px-4', 'py-2');
    expect(result).toBe('px-4 py-2');
  });

  it('handles empty inputs', async () => {
    const { cn } = await import('../src/lib/utils');
    const result = cn();
    expect(result).toBe('');
  });

  it('filters falsy values', async () => {
    const { cn } = await import('../src/lib/utils');
    const result = cn('px-4', false, null, undefined, 'py-2');
    expect(result).toBe('px-4 py-2');
  });

  it('merges tailwind conflicts — last one wins', async () => {
    const { cn } = await import('../src/lib/utils');
    const result = cn('px-4', 'px-8');
    expect(result).toBe('px-8');
  });

  it('handles conditional classes', async () => {
    const { cn } = await import('../src/lib/utils');
    const isActive = true;
    const result = cn('base', isActive && 'active', !isActive && 'inactive');
    expect(result).toBe('base active');
  });

  it('handles conditional false', async () => {
    const { cn } = await import('../src/lib/utils');
    const isActive = false;
    const result = cn('base', isActive && 'active');
    expect(result).toBe('base');
  });

  it('handles arrays of classes', async () => {
    const { cn } = await import('../src/lib/utils');
    const result = cn(['px-4', 'py-2'], 'text-sm');
    expect(result).toBe('px-4 py-2 text-sm');
  });

  it('deduplicates identical classes', async () => {
    const { cn } = await import('../src/lib/utils');
    const result = cn('text-sm', 'text-sm');
    expect(result).toBe('text-sm');
  });
});
