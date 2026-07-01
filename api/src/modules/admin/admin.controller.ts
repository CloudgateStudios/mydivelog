import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { StaffAuthGuard } from "../auth/staff-auth.guard.js";
import { AdminUsersQueryDto } from "./admin.dto.js";
import { AdminService } from "./admin.service.js";

@ApiTags("admin")
@Controller("admin")
@UseGuards(SessionAuthGuard, StaffAuthGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly adminService: AdminService) {}

  @Get("overview")
  @ApiOkResponse({ description: "Read-only operational overview for staff." })
  getOverview() {
    return this.adminService.getOverview();
  }

  @Get("users")
  @ApiOkResponse({ description: "Read-only user list for staff." })
  getUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminService.getUsers(query);
  }
}
