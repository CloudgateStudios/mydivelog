import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.ts';
import { SessionGuard } from './auth/session.guard.ts';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.ts';
import { ProblemDetailsFilter } from './common/problem-details.ts';
import { RateLimitGuard } from './common/rate-limit.guard.ts';
import { RequestIdMiddleware } from './common/request-id.middleware.ts';
import { DivesModule } from './dives/dives.module.ts';
import { HealthModule } from './health/health.module.ts';
import { OpenApiController } from './openapi/openapi.controller.ts';

@Module({
  imports: [AuthModule, HealthModule, DivesModule],
  controllers: [OpenApiController],
  providers: [
    // Authentication is global: a new controller is guarded unless it opts out
    // with @Public. Guarding controller by controller fails open the first time
    // someone forgets.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
