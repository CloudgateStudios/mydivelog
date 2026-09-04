import { Module } from '@nestjs/common';
import { DivesController } from './dives.controller.ts';
import { DivesService } from './dives.service.ts';
import { StatsController } from './stats.controller.ts';

@Module({
  controllers: [DivesController, StatsController],
  providers: [DivesService],
})
export class DivesModule {}
