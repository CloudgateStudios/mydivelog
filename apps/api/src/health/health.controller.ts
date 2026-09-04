import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/session.guard.ts';

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  uptimeSeconds: number;
}

@Controller('health')
export class HealthController {
  // Public by necessity: Fly's machine checks, the CI image check and the
  // deploy smoke test all call this unauthenticated. The global guard would
  // otherwise answer 401 and every one of them would fail.
  @Public()
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      version: process.env['APP_VERSION'] ?? '0.0.0',
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
