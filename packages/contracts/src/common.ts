import { z } from 'zod';

/**
 * Shared shapes. This package is the single source of truth for the API
 * surface: controllers validate against it, the OpenAPI document is generated
 * from it, and both the TypeScript and Dart clients are generated from that.
 * A breaking change here fails the build in several places at once, which is
 * the point.
 */

/** UUIDv7 — time-ordered, and generatable offline so clients never negotiate ids. */
export const Uuid = z.uuid().describe('UUIDv7');

/** All payloads are SI. Conversion is a client concern. */
export const Metres = z.number().finite().describe('metres');
export const Celsius = z.number().finite().describe('degrees Celsius');
export const Seconds = z.number().int().describe('seconds');
export const Kilograms = z.number().finite().nonnegative().describe('kilograms');
export const Bar = z.number().finite().nonnegative().describe('bar');

/**
 * RFC 9457 Problem Details. `type` and `errors[].code` are machine-readable
 * because the Flutter app has to render useful messages offline without
 * parsing English.
 */
export const ProblemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z
    .array(
      z.object({ field: z.string().optional(), code: z.string(), message: z.string().optional() }),
    )
    .optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetails>;

/**
 * Cursor pagination, never offset: logs grow, and an offset skips records when
 * something is inserted while a client is paging.
 */
export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;

export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/** Timestamps are ISO 8601 with an explicit offset. */
export const IsoDateTime = z.iso.datetime({ offset: true });
/** Wall-clock, no timezone — see Dive.startTimeLocal. */
export const IsoLocalDateTime = z.iso.datetime({ local: true });
export const IsoDate = z.iso.date();
