import { SessionKind } from "@prisma/client";

export const SESSION_COOKIE_NAMES: Record<SessionKind, string> = {
  user: "mdl_session",
  admin: "mdl_admin_session",
  mobile: "mdl_mobile_session",
};

export const USER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export function getSessionTtlMs(kind: SessionKind) {
  if (kind === "admin") {
    return ADMIN_SESSION_TTL_MS;
  }

  return USER_SESSION_TTL_MS;
}
