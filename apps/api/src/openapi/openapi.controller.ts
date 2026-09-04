import { Controller, Get } from '@nestjs/common';
import { buildOpenApiDocument } from '@mydivelog/contracts';
import { Public } from '../auth/session.guard.ts';

/**
 * Served from the same schemas the API validates with, so the published
 * contract cannot drift from the implementation.
 */
@Controller('openapi.json')
export class OpenApiController {
  @Public()
  @Get()
  // Annotated because the inferred type reaches into Zod's JSON Schema
  // internals, which are not nameable from here.
  document(): Record<string, unknown> {
    return buildOpenApiDocument(process.env['APP_VERSION'] ?? '0.0.0') as unknown as Record<
      string,
      unknown
    >;
  }
}
