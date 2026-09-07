import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getPrismaClient } from '@mydivelog/db';
import { forbidden, unauthorized } from '../common/problem-details.ts';

/**
 * Who is allowed to change other people's data.
 *
 * The admin panel has no login of its own — it sits behind Cloudflare Access,
 * which is where staff membership actually lives. So the panel forwards the
 * Access token it was given and this guard verifies it again, independently,
 * against Cloudflare's public keys.
 *
 * Verifying twice is the point. `apps/admin/lib/access.ts` protects the panel;
 * this protects the data. They are separate services on separate hostnames and
 * the API must not assume the panel checked anything, or the panel becomes a
 * confused deputy: anything that can reach the API and set a header would be
 * staff.
 *
 * Two things this deliberately does not do:
 *
 * - It does not trust an email header. `Cf-Access-Authenticated-User-Email` is
 *   set by Cloudflare and by anything else that can reach the origin. The
 *   signed token is the only thing that proves anything.
 * - It does not treat Access membership as sufficient. The token proves who
 *   you are; `isStaff` on the row proves you are staff *here*. Both are
 *   required, so removing someone in either place is enough to stop them.
 */

export const STAFF_ONLY = 'staff-only-route';

/**
 * Applied to the admin controller. `SessionGuard` reads the same key and steps
 * aside, because these routes carry Access tokens rather than bearer sessions —
 * so a route is never left with neither guard.
 */
export const StaffOnly = () => SetMetadata(STAFF_ONLY, true);

export type StaffActor = { userId: string; email: string; ip?: string };

const TEAM_DOMAIN = process.env['CF_ACCESS_TEAM_DOMAIN'];
const AUDIENCE = process.env['CF_ACCESS_AUD'];

/**
 * Local development only, and an explicit opt-out rather than an opt-in, so a
 * deployment that forgets to configure Access fails closed. Mirrors
 * `AUTH_DEV_LOGIN_ENABLED` and the panel's own `ADMIN_ACCESS_CHECK_DISABLED`.
 *
 * When it is on, the actor is `ADMIN_DEV_STAFF_EMAIL` and no header is
 * consulted at all — a development bypass that reads an identity out of the
 * request is a production authentication bypass waiting for a misconfiguration.
 */
const checkDisabled = (): boolean => process.env['ADMIN_ACCESS_CHECK_DISABLED'] === 'true';
const devStaffEmail = (): string | undefined => process.env['ADMIN_DEV_STAFF_EMAIL'];

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function keys(): ReturnType<typeof createRemoteJWKSet> | undefined {
  if (!TEAM_DOMAIN) return undefined;
  jwks ??= createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`));
  return jwks;
}

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const staffOnly = this.reflector.getAllAndOverride<boolean>(STAFF_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Every other route in the application: not this guard's business.
    if (!staffOnly) return true;

    const req = context.switchToHttp().getRequest<Request & { staff?: StaffActor }>();
    const email = await this.actorEmail(req);

    const user = await getPrismaClient().user.findUnique({
      where: { email },
      select: { id: true, email: true, isStaff: true, deletedAt: true },
    });
    if (!user || !user.isStaff || user.deletedAt !== null) {
      // Same message either way. Whether a given address is staff is not
      // something an unauthenticated caller should be able to probe.
      throw forbidden('This account is not staff.');
    }

    req.staff = { userId: user.id, email: user.email, ...ip(req) };
    return true;
  }

  private async actorEmail(req: Request): Promise<string> {
    if (checkDisabled()) {
      const email = devStaffEmail();
      if (!email) {
        throw forbidden(
          'ADMIN_ACCESS_CHECK_DISABLED is set but ADMIN_DEV_STAFF_EMAIL is not, so there is ' +
            'no actor to attribute changes to.',
        );
      }
      return email;
    }

    if (!TEAM_DOMAIN || !keys()) {
      throw forbidden(
        'CF_ACCESS_TEAM_DOMAIN is not set, so staff requests cannot be verified. Set it, or ' +
          'set ADMIN_ACCESS_CHECK_DISABLED=true for local development.',
      );
    }

    const token = req.header('cf-access-jwt-assertion');
    if (!token) throw unauthorized('No Cloudflare Access token on this request.');

    // Only the verification is inside the try. A `throw` for a missing claim
    // would otherwise be caught by its own catch and reported as a signature
    // failure, which sends whoever is debugging it to the wrong place.
    let claims: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(token, keys() as NonNullable<typeof jwks>, {
        issuer: `https://${TEAM_DOMAIN}`,
        ...(AUDIENCE === undefined ? {} : { audience: AUDIENCE }),
      });
      claims = payload;
    } catch {
      throw unauthorized('Access token did not verify.');
    }

    const email = claims['email'];
    if (typeof email !== 'string' || !email) {
      throw unauthorized('The Access token carries no email claim.');
    }
    return email;
  }
}

/**
 * The staff member's address, not the admin container's.
 *
 * The panel forwards what Cloudflare told it, and that forwarding is trusted
 * exactly as far as the Access token is: a request that reaches here without a
 * valid token never gets this far. Falls back to the socket address, which at
 * least says which machine.
 */
function ip(req: Request): { ip?: string } {
  const forwarded = req.header('cf-connecting-ip') ?? req.ip;
  return forwarded === undefined ? {} : { ip: forwarded };
}
