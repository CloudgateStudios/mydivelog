import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ExportQuery } from '@mydivelog/contracts';
import { userScope } from '@mydivelog/db';
import { Throttle } from '../common/rate-limit.guard.ts';
import { CurrentUser } from '../auth/current-user.decorator.ts';
import type { AuthedUser } from '../auth/session.guard.ts';
import { ExportsService } from './exports.service.ts';

@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  /**
   * The whole logbook, in one request.
   *
   * Deliberately not paginated. A backup that arrives in pieces is not a
   * backup, and a dive log is small — 197 dives with profiles is a few
   * megabytes.
   */
  @Get()
  // An export reads every dive and decodes every profile. Generous enough for
  // a person, tight enough that it cannot be used to hammer object storage.
  @Throttle(10, 60 * 60_000)
  async export(
    @CurrentUser() user: AuthedUser,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const parsed = ExportQuery.parse({
      ...(query['format'] === undefined ? {} : { format: query['format'] }),
      ...(query['units'] === undefined ? {} : { units: query['units'] }),
    });

    const result = await this.exports.export(userScope(user.id), parsed.format, parsed.units);

    res.setHeader('content-type', result.contentType);
    // A logbook is the diver's own data; a browser should save it, not render it.
    res.setHeader('content-disposition', `attachment; filename="${result.fileName}"`);
    res.send(result.body);
  }
}
