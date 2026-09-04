import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  DevLogin,
  OAuthCallback,
  RefreshRequest,
  RequestMagicLink,
  StartOAuth,
  VerifyMagicLink,
} from '@mydivelog/contracts';
import { badRequest } from '../common/problem-details.ts';
import { Throttle } from '../common/rate-limit.guard.ts';
import { zodBody } from '../common/zod-validation.pipe.ts';
import { AuthService } from './auth.service.ts';
import { CurrentUser } from './current-user.decorator.ts';
import { Public, type AuthedUser } from './session.guard.ts';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('session')
  session(@CurrentUser() user: AuthedUser) {
    return this.auth.session(user.id);
  }

  @Public()
  @Post('oauth/:provider/start')
  @Throttle(20, 60_000)
  start(@Param('provider') provider: string, @Body(zodBody(StartOAuth)) body: StartOAuth) {
    if (provider !== 'google') {
      // Apple arrives in Phase 7 with the iOS app, where the App Store requires it.
      throw badRequest(`Unsupported provider: ${provider}`, 'unsupported_provider');
    }
    return this.auth.startGoogle(body.redirectUri);
  }

  @Public()
  @Post('oauth/:provider/callback')
  @Throttle(20, 60_000)
  callback(@Param('provider') provider: string, @Body(zodBody(OAuthCallback)) body: OAuthCallback) {
    if (provider !== 'google')
      throw badRequest(`Unsupported provider: ${provider}`, 'unsupported_provider');
    return this.auth.completeGoogle(body.code, body.state);
  }

  /** Always 204: any other answer would reveal whether the address is known. */
  @Public()
  @Post('email/request')
  @HttpCode(204)
  @Throttle(3, 60 * 60_000)
  async requestLink(@Body(zodBody(RequestMagicLink)) body: RequestMagicLink, @Req() req: Request) {
    await this.auth.requestMagicLink(body.email, req.ip);
  }

  @Public()
  @Post('email/verify')
  @Throttle(10, 60_000)
  verifyLink(@Body(zodBody(VerifyMagicLink)) body: VerifyMagicLink) {
    return this.auth.verifyMagicLink(body.token);
  }

  @Public()
  @Post('refresh')
  @Throttle(60, 60_000)
  refresh(@Body(zodBody(RefreshRequest)) body: RefreshRequest) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthedUser, @Body() body: { refreshToken?: string }) {
    await this.auth.logout(user.id, body?.refreshToken);
  }

  /** Local development only; refused unless AUTH_DEV_LOGIN_ENABLED is set. */
  @Public()
  @Post('dev/login')
  @Throttle(30, 60_000)
  devLogin(@Body(zodBody(DevLogin)) body: DevLogin) {
    return this.auth.devLogin(body.email, body.displayName);
  }
}
