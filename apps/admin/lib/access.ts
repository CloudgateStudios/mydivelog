import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Cloudflare Access verification.
 *
 * The admin panel is protected by Access on `admin-dev.mydivelog.app`, and
 * that protection is a property of the hostname, not of the application. Fly
 * also serves every app on `<app>.fly.dev`, which reaches the same container
 * without passing through Cloudflare at all — so until this existed, the whole
 * panel was readable by anyone who guessed the app name.
 *
 * Verified here as well, so the origin refuses a request that did not come
 * through Access regardless of which hostname it arrived on. Defence in depth
 * is the usual phrase; in this case the outer layer simply had a door in it.
 *
 * The `Cf-Access-Authenticated-User-Email` header alone is not enough: it is
 * set by Cloudflare, and anything that reaches the origin directly can set it
 * too. The JWT is signed by the team and is what actually proves anything.
 */

const TEAM_DOMAIN = process.env['CF_ACCESS_TEAM_DOMAIN'];
const AUDIENCE = process.env['CF_ACCESS_AUD'];

/**
 * Local development only. Mirrors AUTH_DEV_LOGIN_ENABLED in the API: an
 * explicit opt-out that has to be set on purpose, so the safe state is the
 * default and a misconfigured deployment fails closed rather than open.
 */
const DISABLED = process.env['ADMIN_ACCESS_CHECK_DISABLED'] === 'true';

const jwks = TEAM_DOMAIN
  ? createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`))
  : undefined;

// Said once, at startup, because a half-configured check looks exactly like a
// configured one from the outside. Signature and issuer alone already close
// the hostname bypass this module exists for; the audience narrows it further,
// to tokens minted for this application rather than any application in the
// team.
if (TEAM_DOMAIN && !AUDIENCE && !DISABLED) {
  console.warn(
    'admin: Cloudflare Access tokens are verified against ' +
      `${TEAM_DOMAIN} but the audience is not pinned. Set CF_ACCESS_AUD so a ` +
      'token minted for another application in this Access team is not accepted here.',
  );
}

export type AccessResult =
  | { ok: true; email?: string; reason: 'verified' | 'check-disabled' }
  | { ok: false; reason: string };

export async function verifyAccess(headers: Headers): Promise<AccessResult> {
  if (DISABLED) return { ok: true, reason: 'check-disabled' };

  if (!TEAM_DOMAIN || !jwks) {
    // Fail closed. An unconfigured check is indistinguishable from a missing
    // one, and the failure mode of guessing wrong here is publishing every
    // diver's logbook.
    return {
      ok: false,
      reason:
        'CF_ACCESS_TEAM_DOMAIN is not set, so requests cannot be verified. ' +
        'Set it, or set ADMIN_ACCESS_CHECK_DISABLED=true for local development.',
    };
  }

  const token = headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, reason: 'No Cloudflare Access token on this request.' };

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `https://${TEAM_DOMAIN}`,
      // The audience is per-application. Without it a token minted for any
      // other application in the same Access team would be accepted here.
      ...(AUDIENCE === undefined ? {} : { audience: AUDIENCE }),
    });

    const email = typeof payload['email'] === 'string' ? payload['email'] : undefined;
    return { ok: true, reason: 'verified', ...(email === undefined ? {} : { email }) };
  } catch (err) {
    return { ok: false, reason: `Access token did not verify: ${String(err)}` };
  }
}

/** Whether the audience is pinned. Surfaced so a half-configured check is visible. */
export const accessAudiencePinned = AUDIENCE !== undefined;
export const accessCheckDisabled = DISABLED;
