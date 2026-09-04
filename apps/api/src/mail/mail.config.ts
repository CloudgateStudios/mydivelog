/**
 * Transactional email configuration.
 *
 * Unlike AuthConfig, a missing value here is not fatal: the API is perfectly
 * usable without email, and refusing to boot would take sign-in with Google
 * down alongside it. It degrades to logging instead, loudly.
 */
export class MailConfig {
  readonly apiKey?: string;
  readonly from?: string;
  readonly appUrl: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.apiKey = env['RESEND_API_KEY'] || undefined;
    this.from = env['MAIL_FROM'] || undefined;
    this.appUrl = env['WEB_URL'] ?? 'http://localhost:53000';
  }

  /** Both halves are required: a key with no From address cannot send. */
  get configured(): boolean {
    return this.apiKey !== undefined && this.from !== undefined;
  }
}
