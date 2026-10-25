import { prisma } from '@/lib/prisma';

export async function logAutomationEvent(
  action: string,
  userId: string | null,
  details: Record<string, any>,
  status: 'PENDING' | 'APPROVED' | 'SUCCESS' | 'FAILED' | 'REJECTED'
) {
  try {
    return await prisma.auditLog.create({
      data: {
        action,
        userId,
        details: JSON.stringify(details),
        status,
      },
    });
  } catch (e) {
    console.error('Failed to log audit event:', e);
    return null;
  }
}
