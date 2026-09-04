import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { unauthorized } from '../common/problem-details.ts';
import { AuthConfig } from './auth.config.ts';
import { verifyAccessToken } from './tokens.ts';

export const PUBLIC = 'public-route';
/** Opt out of authentication. Applied per route, never per controller. */
export const Public = () => SetMetadata(PUBLIC, true);

export type AuthedUser = { id: string; email: string; isStaff: boolean };

/**
 * Applied globally, so a new controller is authenticated unless it explicitly
 * opts out. The reverse — guarding each controller as it is written — fails
 * open the first time someone forgets.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AuthConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>();
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw unauthorized('Missing bearer token.');

    const claims = verifyAccessToken(header.slice(7), this.config.accessSecret);
    if (!claims) throw unauthorized('Access token is invalid or expired.');

    req.user = { id: claims.sub, email: claims.email, isStaff: claims.staff };
    return true;
  }
}
