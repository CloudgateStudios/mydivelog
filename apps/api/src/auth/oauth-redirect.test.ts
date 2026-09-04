import { describe, expect, it, vi } from 'vitest';
import { ProblemException } from '../common/problem-details.ts';
import { AuthController } from './auth.controller.ts';
import type { AuthService } from './auth.service.ts';

/**
 * The GET callback is the URL registered with Google, so it is the one route
 * whose behaviour a browser depends on and no other test exercises.
 */
const controller = (webUrl = 'https://dev.mydivelog.app') =>
  new AuthController({ webUrl } as AuthService);

const redirectTo = (
  query: Record<string, string | undefined>,
  provider = 'google',
  webUrl?: string,
): { status: number; url: string } => {
  const res = { redirect: vi.fn() };
  controller(webUrl).callbackRedirect(provider, query, res as never);
  const [status, url] = res.redirect.mock.calls[0] as [number, string];
  return { status, url };
};

describe('GET /auth/oauth/google/callback', () => {
  it('forwards the code and state to the web app', () => {
    const { status, url } = redirectTo({ code: 'auth-code', state: 'state-value' });
    expect(status).toBe(303);
    const target = new URL(url);
    expect(target.origin).toBe('https://dev.mydivelog.app');
    expect(target.pathname).toBe('/auth/callback');
    expect(target.searchParams.get('code')).toBe('auth-code');
    expect(target.searchParams.get('state')).toBe('state-value');
  });

  it('forwards the error when the person declines', () => {
    const { url } = redirectTo({ error: 'access_denied' });
    const target = new URL(url);
    expect(target.searchParams.get('error')).toBe('access_denied');
    expect(target.searchParams.has('code')).toBe(false);
  });

  it('drops anything Google did not send', () => {
    // Only the three known parameters travel onward; a crafted link must not be
    // able to smuggle extra query parameters into our own origin.
    const { url } = redirectTo({ code: 'c', state: 's', next: 'https://evil.invalid' });
    expect(new URL(url).searchParams.has('next')).toBe(false);
  });

  it('escapes parameters rather than concatenating them into the URL', () => {
    const { url } = redirectTo({ code: 'a&b=c', state: 's p' });
    const target = new URL(url);
    expect(target.searchParams.get('code')).toBe('a&b=c');
    expect(target.searchParams.get('state')).toBe('s p');
  });

  it('honours the configured web URL, including a path prefix', () => {
    const { url } = redirectTo({ code: 'c' }, 'google', 'http://localhost:53000');
    expect(url.startsWith('http://localhost:53000/auth/callback')).toBe(true);
  });

  it('refuses a provider that is not wired up', () => {
    // Apple arrives in Phase 7. Until then the route must reject rather than
    // redirect, so a mistyped provider cannot bounce a browser anywhere.
    try {
      redirectTo({ code: 'c' }, 'apple');
      expect.unreachable('a redirect should not have been issued');
    } catch (err) {
      const problem = err as ProblemException;
      expect(problem).toBeInstanceOf(ProblemException);
      expect(problem.getStatus()).toBe(400);
      expect(problem.errors?.[0]?.code).toBe('unsupported_provider');
    }
  });
});
