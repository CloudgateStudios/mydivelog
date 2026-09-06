import { Controller, Get, Param } from '@nestjs/common';
import { createSiteRepository, getPrismaClient, type UserScope } from '@mydivelog/db';
import { Scope } from '../auth/current-user.decorator.ts';
import { notFound } from '../common/problem-details.ts';

/**
 * The sites this diver has been to.
 *
 * Read-only. Sites are created by the importer and edited through the dive
 * that references them; there is no path here for inventing one, because a
 * site with no dives at it is not something this page has any use for.
 */
@Controller('sites')
export class SitesController {
  private readonly repo = createSiteRepository(getPrismaClient());

  @Get()
  async list(@Scope() scope: UserScope) {
    return { data: await this.repo.listForDiver(scope) };
  }

  @Get(':id')
  async get(@Scope() scope: UserScope, @Param('id') id: string) {
    const found = await this.repo.findForDiver(scope, id);
    if (!found) throw notFound('Site');
    return found;
  }
}
