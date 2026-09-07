import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdminController } from './admin.controller.ts';
import { STAFF_ONLY } from './staff.guard.ts';
import { PUBLIC, SessionGuard } from '../auth/session.guard.ts';
import { AuthConfig } from '../auth/auth.config.ts';
import { ProblemException } from '../common/problem-details.ts';

/**
 * How the two guards agree with each other.
 *
 * `SessionGuard` steps aside on a staff route because `StaffGuard` has already
 * authenticated it. That is safe only while both read the same metadata and
 * the metadata is actually there — so the failure this file exists to catch is
 * someone removing `@StaffOnly()` from the controller, which would leave every
 * staff route with no guard at all rather than with the wrong one.
 */

const contextFor = (target: object, handler: () => void): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => target,
    switchToHttp: () => ({
      getRequest: () => ({ header: () => undefined }),
    }),
  }) as unknown as ExecutionContext;

const guard = new SessionGuard(new Reflector(), { accessSecret: 'test-secret' } as AuthConfig);

describe('the staff routes', () => {
  it('are marked staff-only on the controller itself', () => {
    // On the class, not on each method: the default for anything added to that
    // file has to be "staff only". Marking routes individually is what would
    // fail open here, which is the opposite of the rule everywhere else.
    expect(Reflect.getMetadata(STAFF_ONLY, AdminController)).toBe(true);
  });

  it('are never marked public', () => {
    // @Public would skip SessionGuard *and* mean nothing to StaffGuard, which
    // only acts on staff-only routes. The route would be open to anyone.
    expect(Reflect.getMetadata(PUBLIC, AdminController)).toBeUndefined();
    for (const name of Object.getOwnPropertyNames(AdminController.prototype)) {
      if (name === 'constructor') continue;
      const handler = Object.getOwnPropertyDescriptor(AdminController.prototype, name)?.value;
      expect(Reflect.getMetadata(PUBLIC, handler), name).toBeUndefined();
    }
  });

  it('let SessionGuard pass, because StaffGuard has already authenticated them', () => {
    const context = contextFor(AdminController, AdminController.prototype.audit);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('do not make SessionGuard permissive anywhere else', () => {
    // The same call, on a class carrying no staff metadata, still demands a
    // bearer token — so the exemption is scoped to the metadata and not to
    // some ordering accident.
    class Ordinary {
      handler(): void {}
    }
    const context = contextFor(Ordinary, Ordinary.prototype.handler);
    // The detail lives on the Problem Details body, not on Error.message.
    let thrown: unknown;
    try {
      guard.canActivate(context);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ProblemException);
    expect((thrown as ProblemException).getStatus()).toBe(401);
    expect((thrown as ProblemException).getResponse()).toMatchObject({
      detail: 'Missing bearer token.',
    });
  });
});
