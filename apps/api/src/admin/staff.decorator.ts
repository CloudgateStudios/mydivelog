import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { staffScope, type StaffScope } from '@mydivelog/db';
import type { StaffActor } from './staff.guard.ts';

/**
 * The staff member, as a scope the repository will accept.
 *
 * Takes the reason off the request body, because every staff mutation carries
 * one — `staffScope` will not construct without it. Where the contract leaves
 * the reason optional, the fallback is the action's own name, so the audit row
 * always says something even when nobody typed a sentence.
 */
export const Staff = createParamDecorator(
  (fallbackReason: string, ctx: ExecutionContext): StaffScope => {
    const req = ctx.switchToHttp().getRequest<Request & { staff?: StaffActor; body?: unknown }>();
    if (!req.staff) throw new Error('Staff used on a route StaffGuard does not cover');

    const body = req.body as { reason?: unknown } | undefined;
    const typed = typeof body?.reason === 'string' ? body.reason.trim() : '';

    return staffScope(req.staff.userId, typed || fallbackReason, req.staff.ip);
  },
);

/** The actor itself, where the email is what is wanted rather than the scope. */
export const StaffActorOf = createParamDecorator(
  (_d: unknown, ctx: ExecutionContext): StaffActor => {
    const req = ctx.switchToHttp().getRequest<Request & { staff?: StaffActor }>();
    if (!req.staff) throw new Error('StaffActorOf used on a route StaffGuard does not cover');
    return req.staff;
  },
);
