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

export type AdminOverview = {
  counts: {
    users: number;
    staffUsers: number;
    dives: number;
    importBatches: number;
    pendingCanonicalSiteReviews: number;
  };
  recentUsers: AdminUserSummary[];
  recentImports: Array<{
    id: string;
    sourceType: string;
    sourceFilename: string | null;
    status: string;
    createdAt: string;
    completedAt: string | null;
    userEmail: string;
  }>;
};

export type AdminUserSummary = {
  id: string;
  email: string;
  displayName: string | null;
  role: "user" | "staff" | "admin";
  homeUnitSystem: string;
  createdAt: string;
  updatedAt?: string;
  diveCount: number;
  importBatchCount: number;
  sessionCount?: number;
};

export type AdminUsersResponse = {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  users: AdminUserSummary[];
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
    cache: "no-store",
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
        data: null,
      };
    }

    return {
      ok: true,
      statusCode: response.status,
      data: (await response.json()) as HealthResponse,
    };
  } catch {
    return {
      ok: false,
      statusCode: 0,
      data: null,
    };
  }
}

export async function getAdminOverview() {
  const response = await apiFetch("/admin/overview");

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as AdminOverview;
}

export async function getAdminUsers(searchParams: { page?: string; search?: string }) {
  const params = new URLSearchParams();

  if (searchParams.page) {
    params.set("page", searchParams.page);
  }

  if (searchParams.search) {
    params.set("search", searchParams.search);
  }

  params.set("pageSize", "10");

  const response = await apiFetch(`/admin/users?${params.toString()}`);

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as AdminUsersResponse;
}
