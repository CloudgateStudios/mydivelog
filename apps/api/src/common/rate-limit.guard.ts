import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tooManyRequests } from './problem-details.ts';

export type RateLimit = { limit: number; windowMs: number };
export const RATE_LIMIT = 'rate-limit';
export const Throttle = (limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT, { limit, windowMs } satisfies RateLimit);

/**
 * In-memory token bucket, per user or per IP.
 *
 * Deliberately simple: at launch volume a shared store buys nothing, and the
 * counters live behind this one class so moving them to Postgres or Redis is a
 * contained change. Note that with more than one API machine each holds its own
 * counters, so the effective limit is per-machine — acceptable for abuse
 * control, not for billing.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<RateLimit | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { id: string }; staff?: { userId: string } }>();
    // Staff routes have no `user` — they authenticate with a Cloudflare Access
    // token — so without this every staff member shares the admin container's
    // IP bucket and the first one to hit a limit throttles the rest.
    const who = req.user?.id ?? req.staff?.userId ?? req.ip ?? 'unknown';
    const bucketKey = `${who}:${context.getClass().name}.${context.getHandler().name}`;

    const now = Date.now();
    const bucket = this.buckets.get(bucketKey);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
      this.sweep(now);
      return true;
    }

    if (bucket.count >= rule.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      context.switchToHttp().getResponse().setHeader('retry-after', String(retryAfter));
      throw tooManyRequests(`Try again in ${retryAfter}s.`);
    }

    bucket.count += 1;
    return true;
  }

  /** Without this the map grows for every distinct caller, forever. */
  private sweep(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}
