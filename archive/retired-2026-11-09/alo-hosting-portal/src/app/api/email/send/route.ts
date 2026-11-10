import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSession } from '@/lib/auth';
import { sendEmail } from '@/lib/smtp';
import { createAuditLog } from '@/lib/audit';

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await request.json();
    const { to, subject, html, text, from } = body as {
      to: string;
      subject: string;
      html?: string;
      text?: string;
      from?: string;
    };

    if (!to || !subject) {
      throw apiError('to and subject are required', 'VALIDATION_ERROR', undefined, 400);
    }

    if (!html && !text) {
      throw apiError('Either html or text body is required', 'VALIDATION_ERROR', undefined, 400);
    }

    const result = await sendEmail({ to, subject, html, text, from });

    await createAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'EMAIL_SENT',
      resourceType: 'Email',
      metadata: { to, subject, from: from || 'default', messageId: result.messageId, sent: result.sent },
      result: result.sent ? 'SUCCESS' : 'FAILED',
      errorCode: result.error,
    });

    if (!result.sent) {
      throw apiError(`Failed to send email: ${result.error}`, 'EMAIL_SEND_FAILED', { messageId: result.messageId }, 500);
    }

    return NextResponse.json(
      apiSuccess(
        { sent: true, messageId: result.messageId },
        'Email sent successfully',
      ),
    );
  } catch (e) {
    return handleErr(e);
  }
}
