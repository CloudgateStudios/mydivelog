/**
 * Ownership scoping.
 *
 * docs/03-architecture.md states that every user-owned query is scoped by
 * user at the data-access layer, "not by the caller remembering to". A branded
 * type is how that becomes true: repository methods require a `UserScope`, and
 * a `UserScope` can only be produced by `userScope()`. Forgetting to pass one
 * is a compile error, and a raw string will not substitute for one.
 */

declare const scopeBrand: unique symbol;

export type UserScope = {
  readonly userId: string;
  readonly [scopeBrand]: 'UserScope';
};

/** The only way to construct a UserScope. */
export function userScope(userId: string): UserScope {
  if (!userId) {
    throw new Error('userScope requires a user id');
  }
  return { userId } as UserScope;
}

/**
 * Staff paths that legitimately cross users. Separate and explicit, so "this
 * query is not user-scoped" is something you have to write on purpose and can
 * be grepped for.
 *
 * The `reason` is required rather than optional because these now write as
 * well as read — see `repositories/admin.repository.ts`, where every mutation
 * takes one of these and lands its audit row in the same transaction as the
 * change. An unexplained staff mutation is therefore a type error rather than
 * a policy someone is expected to remember.
 */
declare const staffBrand: unique symbol;

export type StaffScope = {
  readonly staffUserId: string;
  readonly reason: string;
  /** Where the request came from, for the audit row. Absent is honest. */
  readonly ip?: string;
  readonly [staffBrand]: 'StaffScope';
};

export function staffScope(staffUserId: string, reason: string, ip?: string): StaffScope {
  if (!staffUserId || !reason) {
    throw new Error('staffScope requires a staff user id and a reason');
  }
  return { staffUserId, reason, ...(ip === undefined ? {} : { ip }) } as StaffScope;
}
