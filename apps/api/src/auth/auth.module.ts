import { Global, Module } from '@nestjs/common';
import { AuthConfig } from './auth.config.ts';
import { AuthController } from './auth.controller.ts';
import { AuthService } from './auth.service.ts';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    // A factory, because the constructor takes an env object that Nest would
    // otherwise try to resolve as an injectable dependency. Keeping the
    // parameter is what makes the config testable without touching process.env.
    { provide: AuthConfig, useFactory: () => new AuthConfig(process.env) },
    AuthService,
  ],
  exports: [AuthConfig, AuthService],
})
export class AuthModule {}
