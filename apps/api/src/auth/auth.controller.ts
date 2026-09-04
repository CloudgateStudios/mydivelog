import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
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
  @HttpCode(200)
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
  @HttpCode(200)
  @Throttle(20, 60_000)
  callback(@Param('provider') provider: string, @Body(zodBody(OAuthCallback)) body: OAuthCallback) {
    if (provider !== 'google')
      throw badRequest(`Unsupported provider: ${provider}`, 'unsupported_provider');
    return this.auth.completeGoogle(body.code, body.state);
  }

  /**
   * Where Google actually sends the browser. The registered redirect URI has to
   * answer a GET on a fixed origin, so the API owns it and hands the parameters
   * to whichever client started the flow.
   *
   * The code is not exchanged here. Doing so would leave the resulting tokens
   * with nowhere to go but a query string or a fragment; instead the client
   * POSTs to the endpoint above. Forwarding the code costs nothing: it is
   * single-use, PKCE-bound, and Google already put it in this URL.
   */
  @Public()
  @Get('oauth/:provider/callback')
  @Throttle(20, 60_000)
  callbackRedirect(
    @Param('provider') provider: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ): void {
    if (provider !== 'google')
      throw badRequest(`Unsupported provider: ${provider}`, 'unsupported_provider');

    const target = new URL('/auth/callback', this.auth.webUrl);
    // Google returns `error` instead of `code` when the person declines. Passing
    // it through lets the client say so rather than wait for a code that is
    // never coming.
    for (const key of ['code', 'state', 'error'] as const) {
      const value = query[key];
      if (value) target.searchParams.set(key, value);
    }
    res.redirect(303, target.toString());
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
  @HttpCode(200)
  @Throttle(10, 60_000)
  verifyLink(@Body(zodBody(VerifyMagicLink)) body: VerifyMagicLink) {
    return this.auth.verifyMagicLink(body.token);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
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
  @HttpCode(200)
  @Throttle(30, 60_000)
  devLogin(@Body(zodBody(DevLogin)) body: DevLogin) {
    return this.auth.devLogin(body.email, body.displayName);
  }
}
