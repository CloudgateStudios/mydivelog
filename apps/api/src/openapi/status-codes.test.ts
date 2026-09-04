import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { buildOpenApiDocument } from '@mydivelog/contracts';
import { describe, expect, it } from 'vitest';
import { AuthController } from '../auth/auth.controller.ts';
import { DivesController } from '../dives/dives.controller.ts';

/**
 * Nest answers 201 to every POST unless a handler says otherwise, and the
 * OpenAPI document is written by hand. The two drifted apart the moment a POST
 * that returns an existing resource was documented as 200: six endpoints
 * claimed 200 and answered 201, and nothing noticed, because the clients that
 * would care are generated from the document rather than from the server.
 *
 * This walks Nest's own route metadata, so it sees what the server will
 * actually send rather than what a test asked it to send.
 */

type Route = { method: string; path: string; status: number; setsOwnStatus: boolean };

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

const routesOf = (controller: new (...args: never[]) => object): Route[] => {
  const base = (Reflect.getMetadata(PATH_METADATA, controller) as string) || '';
  const proto = controller.prototype as object;

  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const handler = Object.getOwnPropertyDescriptor(proto, name)?.value as unknown;
      if (typeof handler !== 'function') return [];
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (verb === undefined) return [];

      const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string) || '';
      const explicit = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined;
      // A handler holding the response object writes the status itself, so
      // metadata cannot say what it will be. The redirect's own test covers it.
      const setsOwnStatus = /@Res|\bres\.(redirect|status)\b/.test(handler.toString());

      // Express-style `:param` in Nest, `{param}` in OpenAPI.
      const path = `/${base}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, '');
      return [
        {
          method: METHOD_NAMES[verb] ?? String(verb),
          path: path.replace(/:(\w+)/g, '{$1}'),
          status: explicit ?? (verb === RequestMethod.POST ? 201 : 200),
          setsOwnStatus,
        },
      ];
    });
};

const routes = [...routesOf(AuthController), ...routesOf(DivesController)];
const spec = buildOpenApiDocument();

const responsesOf = (route: Route): string[] | undefined => {
  const operations = (spec.paths as Record<string, Record<string, { responses: object }>>)[
    route.path
  ];
  const operation = operations?.[route.method];
  return operation ? Object.keys(operation.responses) : undefined;
};

const documented = (route: Route): string[] | undefined =>
  responsesOf(route)?.filter((code) => code.startsWith('2'));

describe('documented status codes match the routes Nest will serve', () => {
  it('found the routes to check', () => {
    // A refactor that renames the metadata keys would otherwise turn this whole
    // suite into a silent no-op.
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes.filter((r) => !r.setsOwnStatus))('$method $path answers $status', (route) => {
    const declared = documented(route);
    if (declared === undefined) return; // deliberately undocumented, e.g. dev login
    expect(declared).toEqual([String(route.status)]);
  });

  it.each(routes.filter((r) => r.setsOwnStatus))(
    '$method $path is documented as a redirect',
    (route) => {
      // Its actual status is asserted in auth/oauth-redirect.test.ts, which
      // calls the handler. All this can check is that the contract agrees it
      // does not return a body.
      expect(documented(route)).toEqual([]);
      expect(responsesOf(route)?.some((code) => code.startsWith('3'))).toBe(true);
    },
  );

  it('documents every route that is not deliberately internal', () => {
    const undocumented = routes
      .filter((r) => documented(r) === undefined)
      .map((r) => `${r.method.toUpperCase()} ${r.path}`);
    // The stub login is left out of the contract on purpose: it does not exist
    // in a deployed environment and no client should be generated against it.
    expect(undocumented).toEqual(['POST /auth/dev/login']);
  });
});
