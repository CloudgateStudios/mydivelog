import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

import { AuthRequest } from "./auth.types.js";

@Injectable()
export class StaffAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const role = request.auth?.user.role;

    if (role !== "staff" && role !== "admin") {
      throw new ForbiddenException("Staff access is required.");
    }

    if (request.auth?.session.kind !== "admin") {
      throw new ForbiddenException("An admin session is required.");
    }

    return true;
  }
}
