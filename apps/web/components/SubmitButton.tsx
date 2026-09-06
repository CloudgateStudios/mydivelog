'use client';

import { useFormStatus } from 'react-dom';

/**
 * A submit button that says what it is doing.
 *
 * Importing ninety-six dives writes ninety-six depth profiles to object
 * storage. That is quick on a laptop and slow over a network, and with no
 * pending state the only honest reading of the screen is that the button is
 * broken — which is what it looked like.
 *
 * `useFormStatus` reads the state of the form this sits inside, so it needs no
 * props threading and no client-side fetching. It also disables the button,
 * which matters more than the label: committing an import twice is not
 * something to leave available while the first one is still running.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = 'button primary',
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * A line of reassurance while a form is in flight.
 *
 * `role="status"` rather than `alert`: this is progress, not a problem, and a
 * screen reader should hear it when it finishes the sentence it is on.
 */
export function PendingNotice({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <p className="notice pending" role="status">
      <span className="spinner" aria-hidden="true" />
      {children}
    </p>
  );
}
