import { z } from 'zod';
import * as auth from './auth.ts';
import * as imports from './imports.ts';
import { PageQuery, ProblemDetails, pageOf } from './common.ts';
import * as dives from './dives.ts';

/**
 * The OpenAPI document is generated from the same Zod schemas the API
 * validates with, so the contract and the implementation cannot drift. Both the
 * TypeScript client (web, admin) and the Dart client (Flutter) are generated
 * from this document.
 */

const json = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'output', target: 'draft-2020-12' });

const problem = {
  description: 'RFC 9457 Problem Details',
  content: { 'application/problem+json': { schema: json(ProblemDetails) } },
};

const ok = (schema: z.ZodType, description = 'Success') => ({
  description,
  content: { 'application/json': { schema: json(schema) } },
});

const body = (schema: z.ZodType) => ({
  required: true,
  content: {
    'application/json': {
      schema: z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' }),
    },
  },
});

const bearer = [{ bearerAuth: [] }];

/** Every unsafe method takes one; an offline client retries blindly. */
const idempotencyKey = {
  name: 'Idempotency-Key',
  in: 'header' as const,
  required: false,
  schema: { type: 'string' as const, maxLength: 255 },
  description: 'Replaying a request with the same key returns the original response.',
};

const queryParams = (schema: z.ZodObject) =>
  Object.entries(
    z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' }).properties ?? {},
  ).map(([name, s]) => ({ name, in: 'query' as const, required: false, schema: s }));

const pathId = {
  name: 'id',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const, format: 'uuid' },
};

export function buildOpenApiDocument(version = '0.0.0') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MyDiveLog API',
      version,
      description:
        'A digital dive logbook. All measurements are SI: metres, degrees Celsius, seconds, ' +
        'kilograms, bar. Unit conversion is a client concern.',
    },
    servers: [
      { url: 'https://api.mydivelog.app/v1', description: 'production' },
      { url: 'https://api-dev.mydivelog.app/v1', description: 'dev' },
      { url: 'http://localhost:53001/v1', description: 'local' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    paths: {
      '/health': {
        get: {
          operationId: 'getHealth',
          tags: ['meta'],
          security: [],
          responses: { '200': ok(z.object({ status: z.literal('ok'), service: z.string() })) },
        },
      },

      '/auth/session': {
        get: {
          operationId: 'getSession',
          tags: ['auth'],
          security: bearer,
          responses: { '200': ok(auth.Session), '401': problem },
        },
      },
      '/auth/oauth/{provider}/start': {
        post: {
          operationId: 'startOAuth',
          tags: ['auth'],
          security: [],
          parameters: [
            {
              name: 'provider',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['google', 'apple'] },
            },
          ],
          requestBody: body(auth.StartOAuth),
          responses: { '200': ok(auth.OAuthStarted), '400': problem },
        },
      },
      '/auth/oauth/{provider}/callback': {
        post: {
          operationId: 'completeOAuth',
          tags: ['auth'],
          security: [],
          parameters: [
            {
              name: 'provider',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['google', 'apple'] },
            },
          ],
          requestBody: body(auth.OAuthCallback),
          responses: { '200': ok(auth.TokenPair), '400': problem, '401': problem },
        },
        // The URL registered with the provider. A browser lands here; it is
        // documented so the redirect target is not a surprise, but no client
        // calls it directly.
        get: {
          operationId: 'oauthCallbackRedirect',
          tags: ['auth'],
          security: [],
          description:
            'Where the provider sends the browser. Forwards code, state and error to ' +
            'WEB_URL/auth/callback, which exchanges the code through the POST above.',
          parameters: [
            {
              name: 'provider',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['google', 'apple'] },
            },
            { name: 'code', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'state', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'error', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { '303': { description: 'Redirect to the web application' }, '400': problem },
        },
      },
      '/auth/email/request': {
        post: {
          operationId: 'requestMagicLink',
          tags: ['auth'],
          security: [],
          requestBody: body(auth.RequestMagicLink),
          // 204 regardless of whether the account exists: anything else
          // enumerates users.
          responses: {
            '204': { description: 'Accepted, whether or not the address is known' },
            '429': problem,
          },
        },
      },
      '/auth/email/verify': {
        post: {
          operationId: 'verifyMagicLink',
          tags: ['auth'],
          security: [],
          requestBody: body(auth.VerifyMagicLink),
          responses: { '200': ok(auth.TokenPair), '400': problem },
        },
      },
      '/auth/refresh': {
        post: {
          operationId: 'refreshTokens',
          tags: ['auth'],
          security: [],
          requestBody: body(auth.RefreshRequest),
          responses: { '200': ok(auth.TokenPair), '401': problem },
        },
      },
      '/auth/logout': {
        post: {
          operationId: 'logout',
          tags: ['auth'],
          security: bearer,
          responses: { '204': { description: 'Signed out' } },
        },
      },

      '/preferences': {
        get: {
          operationId: 'getPreferences',
          tags: ['preferences'],
          security: bearer,
          description:
            'Display units. Returns the defaults rather than 404 for a diver who has never ' +
            'opened settings.',
          responses: { '200': ok(auth.UnitPreferences), '401': problem },
        },
        put: {
          operationId: 'updatePreferences',
          tags: ['preferences'],
          security: bearer,
          requestBody: body(auth.UpdatePreferences),
          responses: { '200': ok(auth.UnitPreferences), '400': problem, '401': problem },
        },
      },
      '/dives': {
        get: {
          operationId: 'listDives',
          tags: ['dives'],
          security: bearer,
          parameters: queryParams(dives.ListDivesQuery),
          responses: { '200': ok(pageOf(dives.Dive)), '401': problem },
        },
        post: {
          operationId: 'createDive',
          tags: ['dives'],
          security: bearer,
          parameters: [idempotencyKey],
          requestBody: body(dives.CreateDive),
          responses: { '201': ok(dives.Dive, 'Created'), '401': problem, '422': problem },
        },
      },
      '/dives/facets': {
        get: {
          operationId: 'getDiveFacets',
          tags: ['dives'],
          security: bearer,
          description:
            'The sites and tags that appear on this diver\u2019s own dives, with counts, plus ' +
            'the range their depths and dates actually span. What a filter UI can offer ' +
            'without offering a way to reach an empty page.',
          responses: { '200': ok(dives.DiveFacets), '401': problem },
        },
      },
      '/stats/overview': {
        get: {
          operationId: 'getStatsOverview',
          tags: ['stats'],
          security: bearer,
          description:
            'Everything the stats page draws, from one pass over the log. One request rather ' +
            'than five, so the numbers cannot disagree with each other.',
          parameters: queryParams(dives.StatsOverviewQuery),
          responses: { '200': ok(dives.StatsOverview), '401': problem },
        },
      },
      '/sites': {
        get: {
          operationId: 'listSites',
          tags: ['sites'],
          security: bearer,
          description:
            'The sites this diver has actually dived, with their own dive count at each. A ' +
            'site nobody has dived is not one of their sites.',
          responses: { '200': ok(z.object({ data: z.array(dives.DiverSite) })), '401': problem },
        },
      },
      '/saved-views': {
        get: {
          operationId: 'listSavedViews',
          tags: ['dives'],
          security: bearer,
          responses: { '200': ok(z.object({ data: z.array(dives.SavedView) })), '401': problem },
        },
        post: {
          operationId: 'createSavedView',
          tags: ['dives'],
          security: bearer,
          description:
            'Saving under a name already in use replaces that view\u2019s filters rather than ' +
            'failing: a diver cannot see the uniqueness constraint, only that nothing happened.',
          requestBody: body(dives.CreateSavedView),
          responses: { '201': ok(dives.SavedView, 'Created'), '401': problem, '422': problem },
        },
      },
      '/saved-views/{id}': {
        delete: {
          operationId: 'deleteSavedView',
          tags: ['dives'],
          security: bearer,
          parameters: [pathId],
          responses: { '204': { description: 'Deleted' }, '401': problem, '404': problem },
        },
      },
      '/dives/{id}/profile': {
        get: {
          operationId: 'getDiveProfile',
          tags: ['dives'],
          security: bearer,
          description:
            'The decoded depth profile. Its own request because the samples are large and ' +
            'most views do not need them.',
          parameters: [pathId],
          responses: { '200': ok(dives.DiveProfileSeries), '401': problem, '404': problem },
        },
      },
      '/dives/{id}': {
        get: {
          operationId: 'getDive',
          tags: ['dives'],
          security: bearer,
          parameters: [pathId],
          // 404 rather than 403 for another user's dive: existence is not disclosed.
          responses: { '200': ok(dives.DiveDetail), '401': problem, '404': problem },
        },
        patch: {
          operationId: 'updateDive',
          tags: ['dives'],
          security: bearer,
          parameters: [pathId, idempotencyKey],
          requestBody: body(dives.UpdateDive),
          responses: { '200': ok(dives.Dive), '401': problem, '404': problem, '422': problem },
        },
        delete: {
          operationId: 'deleteDive',
          tags: ['dives'],
          security: bearer,
          parameters: [pathId, idempotencyKey],
          responses: { '204': { description: 'Soft deleted' }, '401': problem, '404': problem },
        },
      },
      '/dives/{id}/restore': {
        post: {
          operationId: 'restoreDive',
          tags: ['dives'],
          security: bearer,
          parameters: [pathId, idempotencyKey],
          responses: { '200': ok(dives.Dive), '401': problem, '404': problem },
        },
      },
      '/dives/renumber': {
        post: {
          operationId: 'renumberDives',
          tags: ['dives'],
          security: bearer,
          parameters: [idempotencyKey],
          requestBody: body(dives.RenumberDives),
          responses: { '200': ok(dives.RenumberResult), '401': problem },
        },
      },
      '/imports': {
        get: {
          operationId: 'listImports',
          tags: ['imports'],
          responses: { '200': ok(z.object({ data: z.array(imports.ImportBatch) })) },
        },
        post: {
          operationId: 'createImport',
          tags: ['imports'],
          description:
            'Uploads a dive log file as multipart/form-data under the field `file`. ' +
            'Parses and matches it against the existing logbook and returns the proposal. ' +
            'Nothing is written to the logbook until commit.',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: { file: { type: 'string', format: 'binary' } },
                },
              },
            },
          },
          responses: { '201': ok(imports.ImportBatchDetail), '400': problem },
        },
      },
      '/imports/{id}': {
        get: {
          operationId: 'getImport',
          tags: ['imports'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok(imports.ImportBatchDetail), '404': problem },
        },
      },
      '/imports/{id}/rows/{rowIndex}': {
        post: {
          operationId: 'decideImportRow',
          tags: ['imports'],
          description: "Overrides one row's decision before commit.",
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'rowIndex', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          requestBody: body(imports.UpdateImportRow),
          responses: {
            '204': { description: 'Decision recorded' },
            '400': problem,
            '404': problem,
          },
        },
      },
      '/imports/{id}/commit': {
        post: {
          operationId: 'commitImport',
          tags: ['imports'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok(imports.CommitImportResult), '400': problem, '404': problem },
        },
      },
      '/imports/{id}/revert': {
        post: {
          operationId: 'revertImport',
          tags: ['imports'],
          description:
            'Undoes a committed import. Available indefinitely: dives created by the batch ' +
            'are deleted, and dives that pre-existed return to their prior state.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': ok(imports.RevertImportResult), '400': problem, '404': problem },
        },
      },
      '/exports': {
        get: {
          operationId: 'exportLogbook',
          tags: ['exports'],
          description: 'The whole logbook in one request. Deliberately not paginated.',
          parameters: [
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['mydivelog', 'uddf', 'csv'], default: 'mydivelog' },
            },
            {
              name: 'units',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['metric', 'imperial'], default: 'metric' },
            },
          ],
          responses: { '200': { description: 'The logbook, as a file attachment' } },
        },
      },
      '/stats/summary': {
        get: {
          operationId: 'getLogSummary',
          tags: ['stats'],
          security: bearer,
          responses: { '200': ok(dives.LogSummary), '401': problem },
        },
      },
    },
  } as const;
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
export { PageQuery };
