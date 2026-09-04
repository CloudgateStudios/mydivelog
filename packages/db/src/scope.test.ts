import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { staffScope, userScope } from './scope.ts';

describe('userScope', () => {
  it('carries the user id', () => {
    expect(userScope('abc').userId).toBe('abc');
  });

  it('refuses an empty id', () => {
    expect(() => userScope('')).toThrow();
  });
});

describe('staffScope', () => {
  it('requires a reason, so crossing users is deliberate', () => {
    expect(() => staffScope('staff-1', '')).toThrow();
    expect(staffScope('staff-1', 'import support').reason).toBe('import support');
  });
});

/**
 * The acceptance criterion for Phase 1 is that ownership scoping cannot be
 * omitted — a compile error, not a convention. Asserting that by actually
 * running the compiler is the only way to know it is still true.
 */
describe('ownership scoping is enforced by the compiler', () => {
  it('rejects repository calls that omit or fake a UserScope', () => {
    const pkgRoot = fileURLToPath(new URL('..', import.meta.url));

    let output = '';
    let compiled = true;
    try {
      execFileSync(
        'npx',
        ['tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.typetest.json'],
        { cwd: pkgRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      compiled = false;
      const e = error as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }

    expect(compiled, 'scope-omitted.fixture.ts compiled — scoping is not enforced').toBe(false);

    // Assert on error codes rather than line numbers: each violation must be
    // rejected for the right reason, and editing the fixture must not silently
    // weaken the test.
    expect(output, 'omitting the scope entirely should be an arity error').toMatch(
      /error TS2554: Expected 1-2 arguments, but got 0/,
    );
    expect(output, 'a bare user id should not satisfy UserScope').toMatch(
      /error TS2345: Argument of type 'string' is not assignable to parameter of type 'UserScope'/,
    );
    expect(output, 'a hand-rolled object should not satisfy the brand').toMatch(
      /Property '\[scopeBrand\]' is missing/,
    );

    // And all three, not just whichever failed first.
    const violations = output.match(/scope-omitted\.fixture\.ts\(\d+,/g) ?? [];
    expect(new Set(violations).size).toBe(3);
  }, 60_000);
});
