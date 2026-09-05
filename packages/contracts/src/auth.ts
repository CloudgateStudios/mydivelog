import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.ts';

/**
 * No passwords are ever stored. Google OIDC and an email magic link at launch;
 * Apple arrives with the iOS app in Phase 7, where the App Store requires it.
 */
export const AuthProvider = z.enum(['google', 'apple', 'email', 'dev']);

export const SessionUser = z.object({
  id: Uuid,
  email: z.email(),
  displayName: z.string().nullable(),
  isStaff: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUser>;

/** Clients read capability from entitlements, never from a plan name. */
export const Entitlements = z.object({
  plan: z.string(),
  maxDives: z.number().int().nullable(),
  maxStorageMb: z.number().int().nullable(),
  features: z.array(z.string()),
});
export type Entitlements = z.infer<typeof Entitlements>;

export const Session = z.object({
  user: SessionUser,
  entitlements: Entitlements,
});
export type Session = z.infer<typeof Session>;

export const TokenPair = z.object({
  accessToken: z.string(),
  // Rotating, with reuse detection: replaying one revokes the whole family.
  refreshToken: z.string(),
  expiresIn: z.number().int().describe('access token lifetime in seconds'),
  user: SessionUser,
});
export type TokenPair = z.infer<typeof TokenPair>;

export const StartOAuth = z.object({
  redirectUri: z.url().optional(),
});
export const OAuthStarted = z.object({
  authorizationUrl: z.url(),
  state: z.string(),
});
export const OAuthCallback = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type StartOAuth = z.infer<typeof StartOAuth>;
export type OAuthStarted = z.infer<typeof OAuthStarted>;
export type OAuthCallback = z.infer<typeof OAuthCallback>;

export const RequestMagicLink = z.object({ email: z.email() });
export const VerifyMagicLink = z.object({ token: z.string().min(1) });
export type RequestMagicLink = z.infer<typeof RequestMagicLink>;
export type VerifyMagicLink = z.infer<typeof VerifyMagicLink>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(1) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** Development only; refused unless AUTH_DEV_LOGIN_ENABLED is set. */
export const DevLogin = z.object({
  email: z.email(),
  displayName: z.string().max(120).optional(),
});
export type DevLogin = z.infer<typeof DevLogin>;

export const AuthEvent = z.object({
  id: Uuid,
  provider: AuthProvider,
  at: IsoDateTime,
});

/**
 * Display preferences.
 *
 * Per-quantity overrides exist because divers are not consistent — plenty who
 * log depth in feet still think in Celsius — and forcing one system on them
 * makes half their logbook read wrong.
 */
export const UnitPreferences = z.object({
  unitSystem: z.enum(['metric', 'imperial']).default('metric'),
  depthUnit: z.enum(['m', 'ft']).nullish(),
  temperatureUnit: z.enum(['C', 'F']).nullish(),
  weightUnit: z.enum(['kg', 'lb']).nullish(),
  pressureUnit: z.enum(['bar', 'psi']).nullish(),
});
export type UnitPreferences = z.infer<typeof UnitPreferences>;

export const UpdatePreferences = UnitPreferences.partial();
export type UpdatePreferences = z.infer<typeof UpdatePreferences>;
