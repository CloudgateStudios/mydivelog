import { Prisma } from "@prisma/client";

export const DEFAULT_ADMIN_PAGE_SIZE = 20;
export const MAX_ADMIN_PAGE_SIZE = 100;

export type AdminPagination = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

export function normalizeAdminPagination(page?: number, pageSize?: number): AdminPagination {
  const normalizedPage = Math.max(1, Math.trunc(page ?? 1));
  const normalizedPageSize = Math.min(
    MAX_ADMIN_PAGE_SIZE,
    Math.max(1, Math.trunc(pageSize ?? DEFAULT_ADMIN_PAGE_SIZE)),
  );

  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    skip: (normalizedPage - 1) * normalizedPageSize,
    take: normalizedPageSize,
  };
}

export function buildAdminUserSearchWhere(search?: string): Prisma.UserWhereInput {
  const trimmedSearch = search?.trim();

  if (!trimmedSearch) {
    return {};
  }

  return {
    OR: [
      {
        email: {
          contains: trimmedSearch,
          mode: "insensitive",
        },
      },
      {
        displayName: {
          contains: trimmedSearch,
          mode: "insensitive",
        },
      },
    ],
  };
}
