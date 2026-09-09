import { Injectable, Logger } from '@nestjs/common';
import { MailConfig } from './mail.config.ts';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
/** A provider that has stopped answering must not hold a request open. */
const SEND_TIMEOUT_MS = 10_000;

export type Message = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: MailConfig) {}

  /**
   * Delivers, or throws. Callers on an account-enumeration-sensitive path must
   * catch: whether an address exists must not be inferable from the response,
   * and a provider outage is not the caller's news to break.
   */
  async send(message: Message): Promise<void> {
    if (!this.config.configured) {
      throw new Error(
        'Email is not configured: set RESEND_API_KEY and MAIL_FROM to deliver transactional mail.',
      );
    }

    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      // The body carries the actual reason — an unverified domain, a From
      // address the key is not allowed to use. Without it every failure looks
      // the same in the logs.
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend rejected the message: ${res.status} ${detail.slice(0, 500)}`);
    }
  }

  /**
   * Builds and sends the sign-in email. Kept here rather than in AuthService so
   * the wording and the delivery mechanism stay in one place.
   */
  async sendMagicLink(to: string, link: string, ttlMinutes: number): Promise<void> {
    const expiry = `${ttlMinutes} minute${ttlMinutes === 1 ? '' : 's'}`;
    await this.send({
      to,
      subject: 'Your MyDiveLog sign-in link',
      text: [
        'Sign in to MyDiveLog by opening this link:',
        '',
        link,
        '',
        `The link works once and expires in ${expiry}.`,
        'If you did not ask to sign in, you can ignore this email.',
      ].join('\n'),
      html: [
        '<p>Sign in to MyDiveLog:</p>',
        `<p><a href="${escapeHtml(link)}">Sign in to MyDiveLog</a></p>`,
        `<p>The link works once and expires in ${expiry}.</p>`,
        '<p>If you did not ask to sign in, you can ignore this email.</p>',
      ].join('\n'),
    });
  }

  /**
   * Tells a diver their suggested site name was turned down, and why.
   *
   * The reason is required by the contract, not merely encouraged: a refusal
   * with no reason reads as the system losing the suggestion, and the diver
   * has no way to tell the difference. Delivery is best-effort — the decision
   * is already on the suggestion row, which the site page shows, so a provider
   * outage costs the notice and never the answer.
   */
  async sendNameSuggestionRejected(
    to: string,
    suggestion: { proposed: string; siteName: string; note: string; siteUrl: string },
  ): Promise<void> {
    const { proposed, siteName, note, siteUrl } = suggestion;
    await this.send({
      to,
      subject: `About the name you suggested for ${siteName}`,
      text: [
        `You suggested calling this site "${proposed}". We have kept it as "${siteName}".`,
        '',
        `Why: ${note}`,
        '',
        'You can suggest another name if you think this one is still wrong:',
        siteUrl,
        '',
        'Thanks for helping keep the shared site list accurate.',
      ].join('\n'),
      html: [
        `<p>You suggested calling this site <strong>${escapeHtml(proposed)}</strong>. ` +
          `We have kept it as <strong>${escapeHtml(siteName)}</strong>.</p>`,
        `<p>Why: ${escapeHtml(note)}</p>`,
        `<p>You can <a href="${escapeHtml(siteUrl)}">suggest another name</a> if you think ` +
          'this one is still wrong.</p>',
        '<p>Thanks for helping keep the shared site list accurate.</p>',
      ].join('\n'),
    });
  }

  get configured(): boolean {
    return this.config.configured;
  }

  logUnconfigured(email: string): void {
    this.logger.warn(
      `email is not configured; no sign-in link was delivered to ${email}. ` +
        'Set RESEND_API_KEY and MAIL_FROM.',
    );
  }
}

/** The link is ours, but it carries a token — never interpolate it raw. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
