import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import { AuthRequest } from "./auth.types.js";

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthRequest>();
  return request.auth;
});
