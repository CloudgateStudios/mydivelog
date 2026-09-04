import { createHash, randomUUID } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, concatMap, from, of, switchMap, throwError } from 'rxjs';
import { Prisma, getPrismaClient } from '@mydivelog/db';
import { conflict } from './problem-details.ts';

/**
 * Idempotency for unsafe methods.
 *
 * This is not a nicety: the Flutter app queues writes offline and retries them
 * blindly on reconnect, so the same create can arrive several times. A replay
 * must return the original response rather than act again.
 *
 * The request body is fingerprinted alongside the key. Reusing a key with a
 * different body is a client bug, and answering it with the first response
 * would hide that bug rather than surface it.
 */
const UNSAFE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    const res = context.switchToHttp().getResponse<Response>();

    const key = req.header('idempotency-key');
    if (!key || !UNSAFE.has(req.method) || !req.user) {
      return next.handle();
    }

    const prisma = getPrismaClient();
    const userId = req.user.id;
    const path = req.route?.path ?? req.path;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? null))
      .digest('hex');

    return from(
      prisma.idempotencyKey.findUnique({
        where: { userId_key_method_path: { userId, key, method: req.method, path } },
      }),
    ).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw conflict(
              'This Idempotency-Key was already used with a different request body.',
              'idempotency_key_reused',
            );
          }
          if (existing.state === 'in_progress') {
            throw conflict(
              'A request with this Idempotency-Key is still in flight.',
              'idempotency_in_progress',
            );
          }
          res.status(existing.statusCode ?? 200);
          res.setHeader('idempotent-replay', 'true');
          return of(existing.responseBody);
        }

        return from(
          prisma.idempotencyKey.create({
            data: {
              id: randomUUID(),
              userId,
              key,
              method: req.method,
              path,
              requestHash,
              expiresAt: new Date(Date.now() + TTL_MS),
            },
          }),
        ).pipe(
          switchMap((record) =>
            next.handle().pipe(
              // concatMap, not tap: the record has to be marked complete before
              // the response is emitted. A fire-and-forget write loses the race
              // against a client that retries immediately after a dropped
              // connection, which is exactly when a retry happens — the replay
              // finds the record still in progress and is refused.
              concatMap(async (body) => {
                await prisma.idempotencyKey.update({
                  where: { id: record.id },
                  data: {
                    state: 'completed',
                    statusCode: res.statusCode,
                    responseBody:
                      body === undefined || body === null ? Prisma.JsonNull : (body as object),
                  },
                });
                return body;
              }),
              catchError((error: unknown) =>
                // A failed request must not be replayable as a success, and the
                // caller should be free to retry with the same key.
                from(
                  prisma.idempotencyKey.delete({ where: { id: record.id } }).catch(() => {}),
                ).pipe(switchMap(() => throwError(() => error))),
              ),
            ),
          ),
        );
      }),
    );
  }
}
