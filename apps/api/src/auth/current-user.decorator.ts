import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { userScope, type UserScope } from '@mydivelog/db';
import type { AuthedUser } from './session.guard.ts';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthedUser }>();
    if (!req.user) throw new Error('CurrentUser used on a route with no SessionGuard');
    return req.user;
  },
);

/**
 * Hands the repository layer its scope directly, so a controller never sees a
 * bare user id it could forget to pass.
 */
export const Scope = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserScope => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthedUser }>();
  if (!req.user) throw new Error('Scope used on a route with no SessionGuard');
  return userScope(req.user.id);
});
