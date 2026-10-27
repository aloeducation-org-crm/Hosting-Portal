import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { requireSuperAdmin } from '@/lib/auth';
import { env } from '@/lib/env';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const encryptSchema = z.object({
  action: z.enum(['encrypt', 'decrypt']),
  plaintext: z.string().optional(),
  ciphertext: z.string().optional(),
});

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin(request);
    const body = await request.json();
    const input = encryptSchema.parse(body);

    const key = deriveKey(env.APP_ENCRYPTION_KEY);

    if (input.action === 'encrypt') {
      if (!input.plaintext) {
        return NextResponse.json(
          apiError('plaintext is required for encryption', 'VALIDATION_ERROR', undefined, 400),
          { status: 400 },
        );
      }

      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

      let encrypted = cipher.update(input.plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:encrypted
      const result = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;

      return NextResponse.json(apiSuccess({ ciphertext: result }));
    }

    // Decrypt
    if (!input.ciphertext) {
      return NextResponse.json(
        apiError('ciphertext is required for decryption', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    const parts = input.ciphertext.split(':');
    if (parts.length !== 3) {
      return NextResponse.json(
        apiError('Invalid ciphertext format. Expected iv:authTag:encrypted', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    const [ivHex, authTagHex, encrypted] = parts;
    if (!ivHex || !authTagHex || !encrypted) {
      return NextResponse.json(
        apiError('Invalid ciphertext format', 'VALIDATION_ERROR', undefined, 400),
        { status: 400 },
      );
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted: string;
    try {
      decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
    } catch {
      return NextResponse.json(
        apiError('Decryption failed. Invalid ciphertext or wrong key.', 'DECRYPTION_ERROR', undefined, 400),
        { status: 400 },
      );
    }

    return NextResponse.json(apiSuccess({ plaintext: decrypted }));
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(apiError('Validation failed', 'VALIDATION_ERROR', e.flatten(), 400), { status: 400 });
    }
    return handleErr(e);
  }
}
