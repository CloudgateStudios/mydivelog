import { Body, Controller, Get, HttpCode, Param, Patch } from '@nestjs/common';
import { UpdateDiverSite } from '@mydivelog/contracts';
import { createSiteRepository, getPrismaClient, type UserScope } from '@mydivelog/db';
import { Scope } from '../auth/current-user.decorator.ts';
import { conflict, notFound } from '../common/problem-details.ts';
import { zodBody } from '../common/zod-validation.pipe.ts';

/**
 * The sites this diver has been to.
 *
 * There is still no path here for inventing one: a site with no dives at it is
 * not something this page has any use for, and sites arrive with imports.
 * What is new is that a diver can correct one of their own — a site their
 * import created, dived only by them, visible only to them. A dive computer
 * names a site `Unnamed site` because it had only coordinates and an opaque
 * id, and until now nobody but staff could fix that.
 *
 * A site in the shared database is not editable here. Its name belongs to
 * everyone who dives there, and changing it is a suggestion staff approve —
 * see docs/04-data-model.md. Nothing is shared yet, so today this refusal is
 * a promise about later rather than a thing divers meet.
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

  @Patch(':id')
  @HttpCode(200)
  async update(
    @Scope() scope: UserScope,
    @Param('id') id: string,
    @Body(zodBody(UpdateDiverSite)) body: UpdateDiverSite,
  ) {
    const updated = await this.repo.updateOwn(scope, id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.latitude === undefined ? {} : { latitude: body.latitude }),
      ...(body.longitude === undefined ? {} : { longitude: body.longitude }),
      ...(body.typicalEntry === undefined ? {} : { typicalEntry: body.typicalEntry }),
      ...(body.description === undefined ? {} : { description: body.description }),
    });
    if (updated) return updated;

    // Nothing matched, and which of the three reasons it was decides what the
    // diver should do next. A flat 404 for all of them would tell somebody
    // looking at a shared site that their own page does not exist.
    switch (await this.repo.whyNotEditable(scope, id)) {
      case 'shared':
        throw conflict(
          'This site is in the shared database, so its name belongs to everyone who dives ' +
            'there. Suggest a change and a moderator will look at it.',
          'site_is_shared',
        );
      case 'not-yours':
        // Deliberately the same answer as missing. Whether a site exists is
        // not something one diver should be able to learn about another's.
        throw notFound('Site');
      default:
        throw notFound('Site');
    }
  }
}
