import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { AuthService } from "./auth.service.js";
import { CurrentAuth } from "./current-auth.decorator.js";
import { DevLoginDto } from "./auth.dto.js";
import { SessionAuthGuard } from "./session-auth.guard.js";
import { StaffAuthGuard } from "./staff-auth.guard.js";
import { AuthContext, AuthRequest } from "./auth.types.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Get("providers")
  @ApiOkResponse({ description: "Available auth providers for this environment." })
  getProviders() {
    return this.authService.getProviders();
  }

  @Post("dev-login")
  @ApiOkResponse({ description: "Development-only login endpoint for local app work." })
  async devLogin(@Body() dto: DevLoginDto, @Req() request: AuthRequest, @Res({ passthrough: true }) response: any) {
    const session = await this.authService.createDevelopmentSession(dto, request);
    response.cookie(session.cookieName, session.cookieValue, session.cookieOptions);
    return session.auth;
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  @ApiOkResponse({ description: "Current authenticated user and session." })
  getMe(@CurrentAuth() auth: AuthContext) {
    return auth;
  }

  @Get("admin/me")
  @UseGuards(SessionAuthGuard, StaffAuthGuard)
  @ApiOkResponse({ description: "Current authenticated staff user and admin session." })
  getAdminMe(@CurrentAuth() auth: AuthContext) {
    return auth;
  }

  @Post("logout")
  @HttpCode(200)
  @ApiOkResponse({ description: "Revoke the current session and clear auth cookies." })
  async logout(@Req() request: AuthRequest, @Res({ passthrough: true }) response: any) {
    await this.authService.revokeCurrentSession(request);

    for (const cookieName of this.authService.getCookieNames()) {
      response.cookie(cookieName, "", this.authService.getClearCookieOptions());
    }

    return { status: "ok" };
  }
}
