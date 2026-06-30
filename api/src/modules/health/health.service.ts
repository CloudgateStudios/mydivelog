import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class HealthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  getHealth() {
    return {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString()
    };
  }

  async getDatabaseHealth() {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: "ok",
      dependency: "database",
      timestamp: new Date().toISOString()
    };
  }
}
