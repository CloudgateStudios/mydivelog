import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The admin panel was readable by anyone who guessed the Fly app name.
 *
 * Cloudflare Access protects `admin-dev.mydivelog.app`, but that is a property
 * of the hostname; Fly serves the same container on `<app>.fly.dev`, which
 * does not pass through Cloudflare. `mydivelog-admin-dev.fly.dev/dives`
 * returned 200.
 *
 * These tests exist so the fix cannot quietly regress into the same shape.
 */

const load = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import('./access');
};

const original = { ...process.env };

beforeEach(() => {
  for (const key of ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'ADMIN_ACCESS_CHECK_DISABLED']) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.env = { ...original };
});

describe('when nothing is configured', () => {
  it('refuses the request rather than allowing it', async () => {
    // The decision that matters. An unconfigured check is indistinguishable
    // from a missing one, and guessing wrong here publishes every diver's
    // logbook — so the safe state is the default.
    const { verifyAccess } = await load({});
    const result = await verifyAccess(new Headers());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('CF_ACCESS_TEAM_DOMAIN');
  });

  it('refuses even when a Cloudflare header is present', async () => {
    // The header is set by Cloudflare and can be set by anything that reaches
    // the origin directly. It proves nothing on its own.
    const { verifyAccess } = await load({});
    const result = await verifyAccess(
      new Headers({ 'cf-access-authenticated-user-email': 'someone@example.invalid' }),
    );
    expect(result.ok).toBe(false);
  });
});

describe('when a team domain is configured', () => {
  it('refuses a request with no token', async () => {
    const { verifyAccess } = await load({ CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com' });
    const result = await verifyAccess(new Headers());
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('No Cloudflare Access token');
  });

  it('refuses a token that is not signed by the team', async () => {
    const { verifyAccess } = await load({ CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com' });
    const forged = ['eyJhbGciOiJIUzI1NiJ9', 'eyJlbWFpbCI6ImFAYi5jIn0', 'nope'].join('.');
    const result = await verifyAccess(new Headers({ 'cf-access-jwt-assertion': forged }));
    expect(result.ok).toBe(false);
  });

  it('refuses a malformed token rather than throwing', async () => {
    const { verifyAccess } = await load({ CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com' });
    for (const bad of ['', 'not-a-token', 'a.b', 'a.b.c.d']) {
      const result = await verifyAccess(new Headers({ 'cf-access-jwt-assertion': bad }));
      expect(result.ok, bad).toBe(false);
    }
  });

  it('reports whether the audience is pinned', async () => {
    // Without it, a token minted for any other application in the same Access
    // team is accepted here.
    const without = await load({ CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com' });
    expect(without.accessAudiencePinned).toBe(false);

    const withAud = await load({
      CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      CF_ACCESS_AUD: 'abc123',
    });
    expect(withAud.accessAudiencePinned).toBe(true);
  });
});

describe('the local development opt-out', () => {
  it('allows requests only when set explicitly to true', async () => {
    const on = await load({ ADMIN_ACCESS_CHECK_DISABLED: 'true' });
    expect((await on.verifyAccess(new Headers())).ok).toBe(true);

    // Anything else is not an opt-out. `false`, `1` and a typo all fail closed.
    for (const value of ['false', '1', 'yes', 'TRUE']) {
      const off = await load({ ADMIN_ACCESS_CHECK_DISABLED: value });
      expect((await off.verifyAccess(new Headers())).ok, value).toBe(false);
    }
  });

  it('says which branch allowed the request', async () => {
    const { verifyAccess } = await load({ ADMIN_ACCESS_CHECK_DISABLED: 'true' });
    const result = await verifyAccess(new Headers());
    expect(result.ok && result.reason).toBe('check-disabled');
  });
});
