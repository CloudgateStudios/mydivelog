import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  uptimeSeconds: number;
}

@Controller('health')
export class HealthController {
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
