import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { UpdatePreferences } from '@mydivelog/contracts';
import { getPrismaClient, type UserScope } from '@mydivelog/db';
import { zodBody } from '../common/zod-validation.pipe.ts';
import { Scope } from '../auth/current-user.decorator.ts';

/**
 * Display preferences.
 *
 * Read on every page that shows a measurement, so it is deliberately one small
 * row keyed by user rather than something that needs joining.
 */
@Controller('preferences')
export class PreferencesController {
  private readonly prisma = getPrismaClient();

  @Get()
  @HttpCode(200)
  async get(@Scope() scope: UserScope) {
    const row = await this.prisma.userPreferences.findUnique({
      where: { userId: scope.userId },
    });
    // Metric by default, and a diver who has never opened settings has no row.
    // Returning the default rather than 404 keeps every caller from having to
    // know that.
    return {
      unitSystem: row?.unitSystem ?? 'metric',
      depthUnit: row?.depthUnit ?? null,
      temperatureUnit: row?.temperatureUnit ?? null,
      weightUnit: row?.weightUnit ?? null,
      pressureUnit: row?.pressureUnit ?? null,
    };
  }

  @Put()
  @HttpCode(200)
  async update(
    @Scope() scope: UserScope,
    @Body(zodBody(UpdatePreferences)) body: UpdatePreferences,
  ) {
    const data = {
      ...(body.unitSystem === undefined ? {} : { unitSystem: body.unitSystem }),
      ...(body.depthUnit === undefined ? {} : { depthUnit: body.depthUnit }),
      ...(body.temperatureUnit === undefined ? {} : { temperatureUnit: body.temperatureUnit }),
      ...(body.weightUnit === undefined ? {} : { weightUnit: body.weightUnit }),
      ...(body.pressureUnit === undefined ? {} : { pressureUnit: body.pressureUnit }),
    };

    await this.prisma.userPreferences.upsert({
      where: { userId: scope.userId },
      create: { userId: scope.userId, unitSystem: 'metric', ...data },
      update: data,
    });
    return this.get(scope);
  }
}
