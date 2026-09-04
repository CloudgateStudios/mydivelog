import { Controller, Get } from '@nestjs/common';
import type { UserScope } from '@mydivelog/db';
import { Scope } from '../auth/current-user.decorator.ts';
import { DivesService } from './dives.service.ts';

@Controller('stats')
export class StatsController {
  constructor(private readonly dives: DivesService) {}

  /** The numbers the workbook's own summary sheet tried to compute. */
  @Get('summary')
  summary(@Scope() scope: UserScope) {
    return this.dives.summary(scope);
  }

  @Get('intervals')
  intervals(@Scope() scope: UserScope) {
    return this.dives.intervals(scope);
  }
}
