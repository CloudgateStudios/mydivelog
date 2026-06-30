import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";

import { AuthService } from "./auth.service.js";
import { AuthRequest } from "./auth.types.js";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const auth = await this.authService.getAuthContextFromRequest(request);

    if (!auth) {
      throw new UnauthorizedException("Authentication is required.");
    }

    request.auth = auth;
    return true;
  }
}
