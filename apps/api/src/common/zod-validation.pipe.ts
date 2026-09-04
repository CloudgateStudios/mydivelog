import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates against the schemas in @mydivelog/contracts, so controllers cannot
 * declare a shape that differs from the published OpenAPI document. A ZodError
 * is turned into Problem Details by the filter.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    return this.schema.parse(value);
  }
}

export const zodBody = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);
