/**
 * Configuration is read once and validated loudly. A missing secret should stop
 * the process at boot, not surface as a confusing 401 under load.
 */
export class AuthConfig {
  readonly accessSecret: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlDays: number;
  readonly magicLinkTtlMinutes: number;
  readonly devLoginEnabled: boolean;
  readonly google?: { clientId: string; clientSecret: string; redirectUri: string };
  readonly appUrl: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const secret = env['AUTH_ACCESS_SECRET'] ?? '';
    // Dev login is the only mode allowed to run on a generated secret; every
    // other path would be signing real sessions with a value nobody chose.
    this.devLoginEnabled = env['AUTH_DEV_LOGIN_ENABLED'] === 'true';

    if (secret.length < 32 && !this.devLoginEnabled) {
      throw new Error(
        'AUTH_ACCESS_SECRET must be at least 32 characters. Set it, or enable AUTH_DEV_LOGIN_ENABLED for local development.',
      );
    }
    this.accessSecret = secret || 'development-only-secret-do-not-use-in-production';

    this.accessTtlSeconds = Number(env['AUTH_ACCESS_TTL_SECONDS'] ?? 900);
    this.refreshTtlDays = Number(env['AUTH_REFRESH_TTL_DAYS'] ?? 60);
    this.magicLinkTtlMinutes = Number(env['AUTH_MAGIC_LINK_TTL_MINUTES'] ?? 15);
    this.appUrl = env['WEB_URL'] ?? 'http://localhost:53000';

    const id = env['GOOGLE_CLIENT_ID'];
    const secretG = env['GOOGLE_CLIENT_SECRET'];
    const redirect = env['GOOGLE_REDIRECT_URI'];
    if (id && secretG && redirect) {
      this.google = { clientId: id, clientSecret: secretG, redirectUri: redirect };
    }
  }

  get googleConfigured(): boolean {
    return this.google !== undefined;
  }
}
