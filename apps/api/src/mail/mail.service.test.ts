import { afterEach, describe, expect, it, vi } from 'vitest';
import { MailConfig } from './mail.config.ts';
import { MailService } from './mail.service.ts';

const configured = () =>
  new MailConfig({ RESEND_API_KEY: 'key_test', MAIL_FROM: 'MyDiveLog <hi@mydivelog.app>' });

afterEach(() => {
  vi.unstubAllGlobals();
});

const stubFetch = (impl: typeof fetch) => {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
};

describe('MailConfig', () => {
  it('is unconfigured until both the key and the From address are set', () => {
    expect(new MailConfig({}).configured).toBe(false);
    expect(new MailConfig({ RESEND_API_KEY: 'k' }).configured).toBe(false);
    expect(new MailConfig({ MAIL_FROM: 'a@b.invalid' }).configured).toBe(false);
    expect(configured().configured).toBe(true);
  });

  it('treats an empty string as unset', () => {
    // Fly hands through empty values for secrets that were never set; an empty
    // key would otherwise look configured and fail on every send.
    expect(new MailConfig({ RESEND_API_KEY: '', MAIL_FROM: '' }).configured).toBe(false);
  });
});

describe('MailService', () => {
  it('posts the message to Resend with the configured From address', async () => {
    const fetchSpy = stubFetch(async () => new Response('{"id":"1"}', { status: 200 }));
    await new MailService(configured()).sendMagicLink(
      'diver@example.invalid',
      'https://dev.mydivelog.app/auth/verify?token=abc',
      15,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer key_test');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.from).toBe('MyDiveLog <hi@mydivelog.app>');
    expect(body.to).toEqual(['diver@example.invalid']);
    expect(body.text).toContain('https://dev.mydivelog.app/auth/verify?token=abc');
    expect(body.text).toContain('15 minutes');
  });

  it('escapes the link in the HTML body', async () => {
    // The token is opaque and ours, but it lands in an href; a raw quote would
    // break out of the attribute.
    const fetchSpy = stubFetch(async () => new Response('{}', { status: 200 }));
    await new MailService(configured()).sendMagicLink(
      'diver@example.invalid',
      'https://x.invalid/auth/verify?token=a"><script>alert(1)</script>',
      15,
    );
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.html).not.toContain('<script>');
    expect(body.html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('singularises a one-minute expiry', async () => {
    const fetchSpy = stubFetch(async () => new Response('{}', { status: 200 }));
    await new MailService(configured()).sendMagicLink('a@b.invalid', 'https://x.invalid/', 1);
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('1 minute.');
    expect(body.text).not.toContain('1 minutes');
  });

  it('throws with the provider response when Resend rejects the message', async () => {
    stubFetch(async () => new Response('{"message":"domain is not verified"}', { status: 403 }));
    await expect(
      new MailService(configured()).sendMagicLink('a@b.invalid', 'https://x.invalid/', 15),
    ).rejects.toThrow(/403.*domain is not verified/);
  });

  it('throws rather than silently doing nothing when unconfigured', async () => {
    const fetchSpy = stubFetch(async () => new Response('{}', { status: 200 }));
    await expect(
      new MailService(new MailConfig({})).sendMagicLink('a@b.invalid', 'https://x.invalid/', 15),
    ).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
