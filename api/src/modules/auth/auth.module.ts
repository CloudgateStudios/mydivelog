import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionAuthGuard } from "./session-auth.guard.js";
import { StaffAuthGuard } from "./staff-auth.guard.js";

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, SessionAuthGuard, StaffAuthGuard],
  exports: [AuthService, SessionAuthGuard, StaffAuthGuard],
})
export class AuthModule {}
