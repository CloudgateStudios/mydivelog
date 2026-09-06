import { Controller, Get, Query } from '@nestjs/common';
import { StatsOverviewQuery } from '@mydivelog/contracts';
import type { UserScope } from '@mydivelog/db';
import { zodBody } from '../common/zod-validation.pipe.ts';
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

  /** Everything the stats page draws, in one request. */
  @Get('overview')
  overview(
    @Scope() scope: UserScope,
    @Query(zodBody(StatsOverviewQuery)) query: StatsOverviewQuery,
  ) {
    return this.dives.overview(scope, query.bucketM);
  }
}
