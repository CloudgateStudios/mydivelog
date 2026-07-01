import { cookies } from "next/headers";

export type AdminAuth = {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: "user" | "staff" | "admin";
    homeUnitSystem: string;
  };
  session: {
    id: string;
    kind: "user" | "admin" | "mobile";
    expiresAt: string;
  };
};

export type HealthResponse = {
  status: string;
  service?: string;
  dependency?: string;
  timestamp: string;
};

export function getApiBaseUrl() {
  return process.env.ADMIN_API_BASE_URL ?? "http://localhost:3000";
}

export async function getCookieHeader() {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const cookieHeader = await getCookieHeader();
  const headers = new Headers(init.headers);

  if (cookieHeader && !headers.has("cookie")) {
    headers.set("cookie", cookieHeader);
  }

  return fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });
}

export async function getAdminAuth() {
  const response = await apiFetch("/auth/admin/me");

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as AdminAuth;
}

export async function getHealth(path: "/health" | "/health/db") {
  try {
    const response = await apiFetch(path);

    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        data: null
      };
    }

    return {
      ok: true,
      statusCode: response.status,
      data: (await response.json()) as HealthResponse
    };
  } catch {
    return {
      ok: false,
      statusCode: 0,
      data: null
    };
  }
}
