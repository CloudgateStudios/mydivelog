import { SessionKind, UserRole } from "@prisma/client";

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  homeUnitSystem: string;
};

export type AuthenticatedSession = {
  id: string;
  kind: SessionKind;
  expiresAt: Date;
};

export type AuthContext = {
  user: AuthenticatedUser;
  session: AuthenticatedSession;
};

export type AuthRequest = {
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthContext;
  ip?: string;
};
