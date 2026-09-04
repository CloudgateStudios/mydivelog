import { z } from 'zod';
import * as auth from './auth.ts';
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
      '/dives/{id}': {
        get: {
          operationId: 'getDive',
          tags: ['dives'],
          security: bearer,
          parameters: [pathId],
          // 404 rather than 403 for another user's dive: existence is not disclosed.
          responses: { '200': ok(dives.Dive), '401': problem, '404': problem },
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
