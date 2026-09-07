'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * The submit button of a staff form.
 *
 * Disabled and busy while the action runs. Several of these actions take
 * seconds — a merge rewrites every dive at a site, a revert can take a minute —
 * and a button that looks idle while the work happens gets pressed twice.
 */
export function SubmitButton({
  children,
  danger = false,
}: {
  children: ReactNode;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`button${danger ? ' danger' : ''}`}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

/**
 * A banner for what just happened, or just failed to.
 *
 * `role="alert"` on the failure and `role="status"` on the success: one
 * interrupts a screen reader and the other waits its turn, which is the
 * difference between the two messages.
 */
export function Notice({ error, done }: { error?: string; done?: string }) {
  if (error) {
    return (
      <p className="notice bad" role="alert">
        <strong>That did not happen.</strong> {error}
      </p>
    );
  }
  if (done) {
    return (
      <p className="notice good" role="status">
        {done}
      </p>
    );
  }
  return null;
}
