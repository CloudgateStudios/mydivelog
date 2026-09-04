import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateDive, ListDivesQuery, RenumberDives, UpdateDive } from '@mydivelog/contracts';
import type { UserScope } from '@mydivelog/db';
import { zodBody } from '../common/zod-validation.pipe.ts';
import { Scope } from '../auth/current-user.decorator.ts';
import { DivesService } from './dives.service.ts';

@Controller('dives')
export class DivesController {
  constructor(private readonly dives: DivesService) {}

  @Get()
  list(@Scope() scope: UserScope, @Query(zodBody(ListDivesQuery)) query: ListDivesQuery) {
    return this.dives.list(scope, query);
  }

  @Post()
  @HttpCode(201)
  create(@Scope() scope: UserScope, @Body(zodBody(CreateDive)) body: CreateDive) {
    return this.dives.create(scope, body);
  }

  // Declared before ':id' so "renumber" is not parsed as a dive id.
  @Post('renumber')
  @HttpCode(200)
  renumber(@Scope() scope: UserScope, @Body(zodBody(RenumberDives)) body: { startAt: number }) {
    return this.dives.renumber(scope, body.startAt);
  }

  @Get(':id')
  get(@Scope() scope: UserScope, @Param('id') id: string) {
    return this.dives.get(scope, id);
  }

  @Patch(':id')
  update(
    @Scope() scope: UserScope,
    @Param('id') id: string,
    @Body(zodBody(UpdateDive)) body: UpdateDive,
  ) {
    return this.dives.update(scope, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Scope() scope: UserScope, @Param('id') id: string) {
    return this.dives.remove(scope, id);
  }

  @Post(':id/restore')
  @HttpCode(200)
  restore(@Scope() scope: UserScope, @Param('id') id: string) {
    return this.dives.restore(scope, id);
  }
}
