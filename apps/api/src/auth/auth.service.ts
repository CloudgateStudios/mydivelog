import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getPrismaClient } from '@mydivelog/db';
import { badRequest, unauthorized } from '../common/problem-details.ts';
import { MailService } from '../mail/mail.service.ts';
import { AuthConfig } from './auth.config.ts';
import { generateOpaqueToken, hashToken, signAccessToken } from './tokens.ts';

const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; displayName: string | null; isStaff: boolean };
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly prisma = getPrismaClient();

  constructor(
    private readonly config: AuthConfig,
    private readonly mail: MailService,
  ) {}

  /** Where browser flows are sent back to. Read from config, exposed for the
   * OAuth redirect so the controller does not need the config injected too. */
  get webUrl(): string {
    return this.config.appUrl;
  }

  // --- sessions -----------------------------------------------------------

  private async issue(userId: string, familyId?: string, deviceId?: string): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'active' || user.deletedAt) throw unauthorized('Account is not active.');

    const accessToken = signAccessToken(
      { sub: user.id, email: user.email, staff: user.isStaff },
      this.config.accessSecret,
      this.config.accessTtlSeconds,
    );

    const refreshToken = generateOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        familyId: familyId ?? randomUUID(),
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.config.refreshTtlDays * 86_400_000),
        deviceId: deviceId ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTtlSeconds,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isStaff: user.isStaff,
      },
    };
  }

  /**
   * Rotation with reuse detection. Each refresh revokes the token presented and
   * issues a new one in the same family. Presenting an already-used token means
   * it leaked, so the entire family is revoked and the person signs in again.
   */
  async refresh(presented: string): Promise<IssuedTokens> {
    const hash = hashToken(presented);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });

    if (!existing) throw unauthorized('Refresh token is not recognised.');

    if (existing.usedAt || existing.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'reuse_detected' },
      });
      this.logger.warn(`refresh token reuse detected for family ${existing.familyId}`);
      throw unauthorized('Refresh token has already been used. Please sign in again.');
    }

    if (existing.expiresAt <= new Date()) throw unauthorized('Refresh token has expired.');

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { usedAt: new Date(), revokedAt: new Date(), revokedReason: 'rotated' },
    });

    return this.issue(existing.userId, existing.familyId, existing.deviceId ?? undefined);
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const t = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(refreshToken) },
      });
      if (t && t.userId === userId) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: t.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'logout' },
        });
        return;
      }
    }
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  // --- account resolution -------------------------------------------------

  private async upsertUser(
    provider: string,
    subject: string,
    email: string,
    displayName?: string,
  ): Promise<string> {
    const identity = await this.prisma.identity.findUnique({
      where: { provider_subject: { provider, subject } },
      include: { user: true },
    });
    if (identity) return identity.userId;

    // Linking by email is deliberate for OIDC providers that verify it, and is
    // why an unverified email is refused before reaching here.
    const existing = await this.prisma.user.findUnique({ where: { email } });
    const userId = existing?.id ?? randomUUID();

    if (!existing) {
      await this.prisma.user.create({
        data: { id: userId, email, displayName: displayName ?? null },
      });
    }
    await this.prisma.identity.create({
      data: { id: randomUUID(), userId, provider, subject },
    });
    return userId;
  }

  // --- development login --------------------------------------------------

  async devLogin(email: string, displayName?: string): Promise<IssuedTokens> {
    if (!this.config.devLoginEnabled) {
      throw badRequest('Development login is disabled.', 'dev_login_disabled');
    }
    const userId = await this.upsertUser('dev', email, email, displayName);
    return this.issue(userId);
  }

  // --- email magic link ---------------------------------------------------

  /**
   * Always succeeds from the caller's point of view. Returning anything that
   * depends on whether the address is known would enumerate accounts.
   */
  async requestMagicLink(email: string, ip?: string): Promise<{ devLink?: string }> {
    const token = generateOpaqueToken();
    await this.prisma.magicLinkToken.create({
      data: {
        id: randomUUID(),
        email: email.toLowerCase(),
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + this.config.magicLinkTtlMinutes * 60_000),
        ip: ip ?? null,
      },
    });

    const link = `${this.config.appUrl}/auth/verify?token=${token}`;
    if (this.config.devLoginEnabled) {
      // No mail provider is configured locally; the link is logged so the flow
      // is exercisable end to end without one.
      this.logger.log(`magic link for ${email}: ${link}`);
      return { devLink: link };
    }

    if (!this.mail.configured) {
      this.mail.logUnconfigured(email);
      return {};
    }

    try {
      // Awaited, not fired and forgotten: an unawaited rejection would be an
      // unhandled promise, and the work is identical whether or not the address
      // belongs to an account, so waiting leaks no timing signal.
      await this.mail.sendMagicLink(email, link, this.config.magicLinkTtlMinutes);
    } catch (err) {
      // Swallowed on purpose. The endpoint answers 204 for every address, and a
      // provider outage must not turn into an oracle for which ones exist.
      this.logger.error(`could not deliver a sign-in link: ${String(err)}`);
    }
    return {};
  }

  async verifyMagicLink(token: string): Promise<IssuedTokens> {
    const record = await this.prisma.magicLinkToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record) throw unauthorized('This sign-in link is not valid.');
    if (record.consumedAt) throw unauthorized('This sign-in link has already been used.');
    if (record.expiresAt <= new Date()) throw unauthorized('This sign-in link has expired.');

    await this.prisma.magicLinkToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    const userId = await this.upsertUser('email', record.email, record.email);
    return this.issue(userId);
  }

  // --- Google OIDC --------------------------------------------------------

  async startGoogle(redirectUri?: string): Promise<{ authorizationUrl: string; state: string }> {
    const google = this.config.google;
    if (!google) throw badRequest('Google sign-in is not configured.', 'provider_not_configured');

    const state = generateOpaqueToken();
    const verifier = generateOpaqueToken();
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    await this.prisma.oAuthState.create({
      data: {
        id: randomUUID(),
        provider: 'google',
        stateHash: hashToken(state),
        redirectUri: redirectUri ?? null,
        codeVerifier: verifier,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });

    const url = new URL(GOOGLE_AUTH);
    url.searchParams.set('client_id', google.clientId);
    url.searchParams.set('redirect_uri', google.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    // PKCE, even with a confidential client: it removes the value of an
    // intercepted authorization code outright.
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return { authorizationUrl: url.toString(), state };
  }

  async completeGoogle(code: string, state: string): Promise<IssuedTokens> {
    const google = this.config.google;
    if (!google) throw badRequest('Google sign-in is not configured.', 'provider_not_configured');

    const stored = await this.prisma.oAuthState.findUnique({
      where: { stateHash: hashToken(state) },
    });
    if (!stored || stored.provider !== 'google') throw unauthorized('Sign-in state is not valid.');
    if (stored.expiresAt <= new Date())
      throw unauthorized('Sign-in took too long. Please try again.');
    // Single use: consumed before the exchange, so a replayed callback cannot
    // mint a second session.
    await this.prisma.oAuthState.delete({ where: { id: stored.id } });

    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: google.clientId,
        client_secret: google.clientSecret,
        redirect_uri: google.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: stored.codeVerifier ?? '',
      }),
    });
    if (!res.ok) {
      this.logger.warn(`google token exchange failed: ${res.status}`);
      throw unauthorized('Could not complete Google sign-in.');
    }

    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    if (!idToken) throw unauthorized('Google did not return an identity token.');

    const { payload } = await jwtVerify(idToken, googleJwks, {
      issuer: [GOOGLE_ISSUER, 'accounts.google.com'],
      audience: google.clientId,
    });

    const email = typeof payload['email'] === 'string' ? payload['email'] : undefined;
    // An unverified address must not link to an existing account: anyone can
    // claim an address they do not control.
    if (!email || payload['email_verified'] !== true) {
      throw unauthorized('Google account has no verified email address.');
    }

    const userId = await this.upsertUser(
      'google',
      String(payload.sub),
      email.toLowerCase(),
      typeof payload['name'] === 'string' ? payload['name'] : undefined,
    );
    return this.issue(userId);
  }

  // --- session ------------------------------------------------------------

  async session(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { entitlement: true, subscription: true },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isStaff: user.isStaff,
      },
      entitlements: {
        plan: user.subscription?.plan ?? 'free',
        maxDives: user.entitlement?.maxDives ?? null,
        maxStorageMb: user.entitlement?.maxStorageMb ?? null,
        features: user.entitlement?.features ?? [],
      },
    };
  }
}
