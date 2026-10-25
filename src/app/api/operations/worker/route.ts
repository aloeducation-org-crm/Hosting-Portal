import { NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, type ApiResponse } from '@/lib/response';
import { env } from '@/lib/env';
import { callHelper } from '@/lib/helpers';
import {
  getPendingOperations,
  startOperation,
  completeOperation,
  failOperation,
  updateOperationProgress,
  type OperationType,
} from '@/lib/operations';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

// ─── Operation Type → Helper Mapping ────────────────────────────────────────────

type HelperMapping = {
  helper: string;
  buildArgs: (input: Record<string, unknown>) => string[];
};

const OPERATION_HELPERS: Record<string, HelperMapping> = {
  WEBSITE_CREATE: {
    helper: 'alo-hosting-helper',
    buildArgs: (input) => ['provision-static', String(input.domain ?? '')],
  },
  SSL_ISSUE: {
    helper: 'alo-ssl-helper',
    buildArgs: (input) => ['issue', String(input.domain ?? ''), String(input.email ?? '')],
  },
  DATABASE_CREATE: {
    helper: 'alo-database-helper',
    buildArgs: (input) => {
      const engine = input.engine ?? 'mariadb';
      const cmd = engine === 'postgresql' ? 'create-postgresql' : 'create-mariadb';
      return [cmd, String(input.name ?? ''), String(input.password ?? '')];
    },
  },
  FIREWALL_ADD: {
    helper: 'alo-firewall-helper',
    buildArgs: (input) => [
      'add-rule',
      String(input.port ?? ''),
      String(input.protocol ?? 'tcp'),
      String(input.direction ?? 'in'),
    ],
  },
  DOCKER_RUN: {
    helper: 'alo-hosting-helper',
    buildArgs: (input) => [
      'run',
      String(input.image ?? ''),
      String(input.containerName ?? ''),
      String(input.port ?? ''),
    ],
  },
  SITE_SUSPEND: {
    helper: 'alo-site-lifecycle',
    buildArgs: (input) => ['suspend', String(input.domain ?? '')],
  },
  SITE_RESUME: {
    helper: 'alo-site-lifecycle',
    buildArgs: (input) => ['resume', String(input.domain ?? '')],
  },
};

function verifyInternalSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const querySecret = new URL(request.url).searchParams.get('secret');
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const provided = bearer ?? querySecret;
  return provided === env.INTERNAL_SECRET;
}

function handleErr(e: unknown): NextResponse {
  if (e && typeof e === 'object' && 'status' in e) {
    const a = e as ApiResponse;
    return NextResponse.json(a, { status: a.status });
  }
  return NextResponse.json(apiError('Internal server error'), { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyInternalSecret(request)) {
      return NextResponse.json(
        apiError('Unauthorized', 'UNAUTHORIZED', undefined, 401),
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '5', 10), 20);

    const pending = await getPendingOperations(limit);
    if (pending.length === 0) {
      return NextResponse.json(apiSuccess({ processed: 0, results: [] }, 'No pending operations'));
    }

    const results: Array<{
      id: string;
      type: string;
      status: string;
      error?: string;
      durationMs?: number;
    }> = [];

    for (const op of pending) {
      const startTime = Date.now();
      const parsedInput: Record<string, unknown> = JSON.parse(op.input ?? '{}');

      const mapping = OPERATION_HELPERS[op.type];
      if (!mapping) {
        logger.error({ operationId: op.id, type: op.type }, 'Unknown operation type');
        await failOperation(op.id, `Unknown operation type: ${op.type}`);
        results.push({ id: op.id, type: op.type, status: 'FAILED', error: 'Unknown operation type' });
        continue;
      }

      try {
        // Transition to RUNNING
        await startOperation(op.id);

        // Build helper arguments
        const helperArgs = mapping.buildArgs(parsedInput);
        logger.info(
          { operationId: op.id, helper: mapping.helper, args: helperArgs },
          'Executing operation helper',
        );

        // Update progress to indicate active work
        await updateOperationProgress(op.id, 30);

        // Call the helper
        const helperResult = await callHelper(mapping.helper, helperArgs);

        const durationMs = Date.now() - startTime;

        if (helperResult.success) {
          await completeOperation(op.id, {
            exitCode: helperResult.exitCode,
            stdout: helperResult.stdout.slice(0, 5000),
          });
          results.push({ id: op.id, type: op.type, status: 'SUCCESS', durationMs });
        } else {
          await failOperation(op.id, helperResult.stderr || 'Helper returned non-zero exit code');
          results.push({
            id: op.id,
            type: op.type,
            status: 'FAILED',
            error: helperResult.stderr?.slice(0, 500),
            durationMs,
          });
        }
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ operationId: op.id, error: msg }, 'Operation execution error');
        await failOperation(op.id, msg);
        results.push({ id: op.id, type: op.type, status: 'FAILED', error: msg, durationMs });
      }
    }

    // Record audit logs for processed operations
    for (const r of results) {
      const op = pending.find((p: { id: string }) => p.id === r.id);
      if (op) {
        await db.auditLog.create({
          data: {
            actorUserId: op.actorId,
            actorEmail: op.actorEmail,
            actorRole: op.actorRole,
            action: 'OPERATION_PROCESS',
            resourceType: 'Operation',
            resourceId: op.id,
            result: r.status,
            errorCode: r.error ? 'OPERATION_ERROR' : undefined,
            durationMs: r.durationMs,
          },
        });
      }
    }

    logger.info({ processed: results.length }, 'Worker batch completed');
    return NextResponse.json(apiSuccess({ processed: results.length, results }, 'Worker batch completed'));
  } catch (e) {
    return handleErr(e);
  }
}
