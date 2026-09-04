import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module.ts';

@Module({ imports: [HealthModule] })
export class AppModule {}
