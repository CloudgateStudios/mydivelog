import { Inject, Injectable } from "@nestjs/common";
import { UserRole } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service.js";
import { AdminUsersQueryDto } from "./admin.dto.js";
import { buildAdminUserSearchWhere, normalizeAdminPagination } from "./admin.query.js";

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getOverview() {
    const [totalUsers, staffUsers, totalDives, importBatches, pendingCanonicalSiteReviews, recentUsers, recentImports] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({
          where: {
            role: {
              in: [UserRole.staff, UserRole.admin],
            },
          },
        }),
        this.prisma.dive.count(),
        this.prisma.importBatch.count(),
        this.prisma.canonicalSiteReviewItem.count({
          where: {
            status: "pending",
          },
        }),
        this.prisma.user.findMany({
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
          select: {
            id: true,
            email: true,
            displayName: true,
            role: true,
            homeUnitSystem: true,
            createdAt: true,
            _count: {
              select: {
                dives: true,
                importBatches: true,
              },
            },
          },
        }),
        this.prisma.importBatch.findMany({
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
          select: {
            id: true,
            sourceType: true,
            sourceFilename: true,
            status: true,
            createdAt: true,
            completedAt: true,
            user: {
              select: {
                email: true,
              },
            },
          },
        }),
      ]);

    return {
      counts: {
        users: totalUsers,
        staffUsers,
        dives: totalDives,
        importBatches,
        pendingCanonicalSiteReviews,
      },
      recentUsers: recentUsers.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        homeUnitSystem: user.homeUnitSystem,
        createdAt: user.createdAt,
        diveCount: user._count.dives,
        importBatchCount: user._count.importBatches,
      })),
      recentImports: recentImports.map((importBatch) => ({
        id: importBatch.id,
        sourceType: importBatch.sourceType,
        sourceFilename: importBatch.sourceFilename,
        status: importBatch.status,
        createdAt: importBatch.createdAt,
        completedAt: importBatch.completedAt,
        userEmail: importBatch.user.email,
      })),
    };
  }

  async getUsers(query: AdminUsersQueryDto) {
    const pagination = normalizeAdminPagination(query.page, query.pageSize);
    const where = buildAdminUserSearchWhere(query.search);
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          homeUnitSystem: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              dives: true,
              importBatches: true,
              sessions: true,
            },
          },
        },
      }),
    ]);

    return {
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
      },
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        homeUnitSystem: user.homeUnitSystem,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        diveCount: user._count.dives,
        importBatchCount: user._count.importBatches,
        sessionCount: user._count.sessions,
      })),
    };
  }
}
