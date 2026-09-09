import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { SuggestSiteName, UpdateDiverSite } from '@mydivelog/contracts';
import {
  createSiteRepository,
  createSuggestionRepository,
  getPrismaClient,
  SuggestionRefusal,
  type UserScope,
} from '@mydivelog/db';
import { Scope } from '../auth/current-user.decorator.ts';
import { conflict, notFound } from '../common/problem-details.ts';
import { Throttle } from '../common/rate-limit.guard.ts';
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
  private readonly suggestions = createSuggestionRepository(getPrismaClient());

  @Get()
  async list(@Scope() scope: UserScope) {
    return { data: await this.repo.listForDiver(scope) };
  }

  @Get(':id')
  async get(@Scope() scope: UserScope, @Param('id') id: string) {
    const found = await this.repo.findForDiver(scope, id);
    if (!found) throw notFound('Site');
    // Their own proposals, so a decision is visible where they made it. The
    // emailed notice can fail; this cannot.
    return { ...found, suggestions: await this.suggestions.mineFor(scope, id) };
  }

  /**
   * Propose a name for a shared site.
   *
   * Deliberately not an edit. Once a site is in the shared database its name
   * is everyone's, so this records a request and staff answer it — and the
   * answer is kept on the row so a diver can read a refusal rather than watch
   * a name silently not change.
   */
  @Post(':id/name-suggestions')
  @HttpCode(201)
  // A moderation queue is only readable if it is not a place to shout into.
  @Throttle(10, 60 * 60_000)
  async suggestName(
    @Scope() scope: UserScope,
    @Param('id') id: string,
    @Body(zodBody(SuggestSiteName)) body: SuggestSiteName,
  ) {
    try {
      const created = await this.suggestions.suggest(scope, id, body.proposed, body.reason);
      if (!created) throw notFound('Site');
      return created;
    } catch (err) {
      if (err instanceof SuggestionRefusal) throw conflict(err.message, err.code);
      throw err;
    }
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
