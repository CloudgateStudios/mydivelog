import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { CreateGearItem, UpdateGearItem } from '@mydivelog/contracts';
import { createGearRepository, getPrismaClient, type UserScope } from '@mydivelog/db';
import { zodBody } from '../common/zod-validation.pipe.ts';
import { Scope } from '../auth/current-user.decorator.ts';
import { conflict, notFound } from '../common/problem-details.ts';

const day = (iso: string | null | undefined): Date | null =>
  iso === null || iso === undefined || iso === '' ? null : new Date(`${iso}T00:00:00.000Z`);

@Controller('gear')
export class GearController {
  private readonly repo = createGearRepository(getPrismaClient());

  @Get()
  async list(@Scope() scope: UserScope) {
    return { data: await this.repo.list(scope) };
  }

  /** Declared before ':id'. Kit the importer saw, with no item for it yet. */
  @Get('suggestions')
  async suggestions(@Scope() scope: UserScope) {
    return { data: await this.repo.suggestions(scope) };
  }

  @Post()
  @HttpCode(201)
  async create(@Scope() scope: UserScope, @Body(zodBody(CreateGearItem)) body: CreateGearItem) {
    const item = await this.repo.create(scope, randomUUID(), {
      kind: body.kind,
      name: body.name,
      brand: body.brand ?? null,
      model: body.model ?? null,
      serialNumber: body.serialNumber ?? null,
      purchasedOn: day(body.purchasedOn),
      serviceDueOn: day(body.serviceDueOn),
      ...(body.isRental === undefined ? {} : { isRental: body.isRental }),
    });

    const linked = body.linkImportedDives
      ? await this.repo.linkImported(scope, item.id, body.name)
      : 0;
    return { ...item, dives: linked };
  }

  @Patch(':id')
  @HttpCode(200)
  async update(
    @Scope() scope: UserScope,
    @Param('id') id: string,
    @Body(zodBody(UpdateGearItem)) body: UpdateGearItem,
  ) {
    const updated = await this.repo.update(scope, id, {
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.brand === undefined ? {} : { brand: body.brand ?? null }),
      ...(body.model === undefined ? {} : { model: body.model ?? null }),
      ...(body.serialNumber === undefined ? {} : { serialNumber: body.serialNumber ?? null }),
      ...(body.purchasedOn === undefined ? {} : { purchasedOn: day(body.purchasedOn) }),
      ...(body.serviceDueOn === undefined ? {} : { serviceDueOn: day(body.serviceDueOn) }),
      ...(body.isRental === undefined ? {} : { isRental: body.isRental }),
      ...(body.retired === undefined ? {} : { retired: body.retired }),
    });
    if (!updated) throw notFound('Gear item');
    return updated;
  }

  /**
   * Deleting is only for kit that was never on a dive.
   *
   * A wetsuit you no longer own was still on four hundred dives, and removing
   * it would rewrite them. The 409 says to retire it instead, which is a
   * refusal the diver can act on rather than a silent no-op.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Scope() scope: UserScope, @Param('id') id: string) {
    const outcome = await this.repo.remove(scope, id);
    if (outcome === 'missing') throw notFound('Gear item');
    if (outcome === 'in-use') {
      throw conflict(
        'This gear has been on dives, so deleting it would change them. Retire it instead.',
        'gear_in_use',
      );
    }
  }
}
