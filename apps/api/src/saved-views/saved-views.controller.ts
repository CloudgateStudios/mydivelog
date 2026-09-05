import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CreateSavedView, ListDivesQuery } from '@mydivelog/contracts';
import { createSavedViewRepository, getPrismaClient, type UserScope } from '@mydivelog/db';
import { zodBody } from '../common/zod-validation.pipe.ts';
import { Scope } from '../auth/current-user.decorator.ts';
import { notFound } from '../common/problem-details.ts';

/**
 * Named filter sets.
 *
 * The stored query string is normalised through ListDivesQuery on the way in
 * *and* on the way out. In means a diver cannot save a view that would 400 the
 * moment they opened it; out means a view saved against an older filter set
 * still opens, carrying the filters that still exist rather than failing whole.
 */
export function normalizeQuery(raw: string): string {
  const parsed = ListDivesQuery.safeParse(paramsToObject(new URLSearchParams(raw)));
  if (!parsed.success) return '';

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    // Paging is not part of a view: a cursor points into one particular result
    // set, and reopening a saved view a month later must not resume from a page
    // boundary computed against a shorter logbook.
    if (key === 'cursor' || key === 'limit' || value === undefined) continue;
    // Repeated values are sorted too, not just the keys: tags are ANDed, so
    // wreck+night and night+wreck are one filter and must be one string.
    if (Array.isArray(value)) for (const v of [...value].map(String).sort()) params.append(key, v);
    else params.set(key, String(value));
  }
  params.sort(); // by key; combined with the above, the same filters save as the same string
  return params.toString();
}

/**
 * A URLSearchParams as the object Zod parses.
 *
 * Not `Object.fromEntries`, which keeps only the last value for a repeated key
 * — `?tag=wreck&tag=night` would silently become `tag=night`, and a filter that
 * was meant to narrow to wreck dives at night would return every night dive.
 * A filter that quietly matches more than it was asked to is worse than one
 * that errors.
 */
function paramsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length > 1 ? values : (values[0] as string);
  }
  return out;
}

@Controller('saved-views')
export class SavedViewsController {
  private readonly repo = createSavedViewRepository(getPrismaClient());

  @Get()
  async list(@Scope() scope: UserScope) {
    const rows = await this.repo.list(scope);
    return { data: rows.map((row) => ({ ...row, query: normalizeQuery(row.query) })) };
  }

  @Post()
  @HttpCode(201)
  async create(@Scope() scope: UserScope, @Body(zodBody(CreateSavedView)) body: CreateSavedView) {
    return this.repo.upsert(scope, randomUUID(), {
      name: body.name,
      query: normalizeQuery(body.query),
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Scope() scope: UserScope, @Param('id') id: string) {
    if (!(await this.repo.remove(scope, id))) throw notFound('Saved view');
  }
}
