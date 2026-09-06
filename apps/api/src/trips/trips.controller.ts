import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AssignDives, CreateTrip, UpdateTrip } from '@mydivelog/contracts';
import { suggestTrips } from '@mydivelog/domain';
import { createTripRepository, getPrismaClient, type UserScope } from '@mydivelog/db';
import { zodBody } from '../common/zod-validation.pipe.ts';
import { Scope } from '../auth/current-user.decorator.ts';
import { notFound } from '../common/problem-details.ts';

/** A date-only field, stored as a date. Times would be a lie about precision. */
const day = (iso: string | null | undefined): Date | null =>
  iso === null || iso === undefined || iso === '' ? null : new Date(`${iso}T00:00:00.000Z`);

@Controller('trips')
export class TripsController {
  private readonly repo = createTripRepository(getPrismaClient());

  @Get()
  async list(@Scope() scope: UserScope) {
    return { data: await this.repo.list(scope) };
  }

  /**
   * Trips this logbook already describes, which the diver has not created yet.
   *
   * Declared before ':id'. Proposals only — nothing is written until the diver
   * accepts one, because "these seventeen dives were one holiday" is a guess
   * about intent, not a fact in the data.
   */
  @Get('suggestions')
  async suggestions(@Scope() scope: UserScope) {
    const dives = await this.repo.unassigned(scope);
    return {
      data: suggestTrips(
        dives.map((dive) => ({
          id: dive.id,
          startTimeLocal: dive.startTimeLocal,
          ...(dive.site?.name === undefined ? {} : { siteName: dive.site.name }),
          ...(dive.site?.region?.name === undefined ? {} : { regionName: dive.site.region.name }),
        })),
      ),
    };
  }

  /** Dives in no trip, for the picker. */
  @Get('unassigned')
  async unassigned(@Scope() scope: UserScope) {
    return { data: await this.repo.unassigned(scope) };
  }

  @Get(':id')
  async get(@Scope() scope: UserScope, @Param('id') id: string) {
    const found = await this.repo.find(scope, id);
    if (!found) throw notFound('Trip');
    return found;
  }

  @Post()
  @HttpCode(201)
  async create(@Scope() scope: UserScope, @Body(zodBody(CreateTrip)) body: CreateTrip) {
    return this.repo.create(scope, randomUUID(), {
      name: body.name,
      startDate: day(body.startDate),
      endDate: day(body.endDate),
      operator: body.operator ?? null,
      notes: body.notes ?? null,
    });
  }

  @Patch(':id')
  @HttpCode(200)
  async update(
    @Scope() scope: UserScope,
    @Param('id') id: string,
    @Body(zodBody(UpdateTrip)) body: UpdateTrip,
  ) {
    const updated = await this.repo.update(scope, id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.startDate === undefined ? {} : { startDate: day(body.startDate) }),
      ...(body.endDate === undefined ? {} : { endDate: day(body.endDate) }),
      ...(body.operator === undefined ? {} : { operator: body.operator ?? null }),
      ...(body.notes === undefined ? {} : { notes: body.notes ?? null }),
    });
    if (!updated) throw notFound('Trip');
    return updated;
  }

  /** The trip goes; the diving does not. See the repository. */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Scope() scope: UserScope, @Param('id') id: string) {
    if (!(await this.repo.remove(scope, id))) throw notFound('Trip');
  }

  @Post(':id/dives')
  @HttpCode(200)
  async addDives(
    @Scope() scope: UserScope,
    @Param('id') id: string,
    @Body(zodBody(AssignDives)) body: AssignDives,
  ) {
    const changed = await this.repo.setDives(scope, id, body.diveIds);
    if (changed === null) throw notFound('Trip');
    return { changed };
  }

  @Delete(':id/dives/:diveId')
  @HttpCode(204)
  async removeDive(
    @Scope() scope: UserScope,
    @Param('id') id: string,
    @Param('diveId') diveId: string,
  ) {
    if ((await this.repo.setDives(scope, null, [diveId])) === null) throw notFound('Trip');
  }
}
