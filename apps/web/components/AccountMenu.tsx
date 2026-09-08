'use client';

import { useEffect, useRef } from 'react';

/**
 * The account menu: who you are, and the two things you can do about it.
 *
 * Built on `<details>` rather than a button and a state flag, for the same
 * reason the import drop zone is a real form control: it opens with no
 * JavaScript at all, so a diver on a bad connection can still reach settings
 * and sign out. It is also how every other disclosure here is built — the
 * chart tables, the import row groups.
 *
 * No `aria-expanded`, deliberately. A `<details>` has the role `group`, which
 * ARIA does not define that attribute for; the open state is part of the
 * element's own semantics and assistive software announces it from there.
 * Adding the attribute by hand would mean maintaining a second copy of the
 * state that says nothing the first one does not.
 *
 * A disclosure holding two links, rather than the ARIA menu pattern. A real
 * `role="menu"` owes the reader arrow-key roaming, type-ahead and a focus
 * model, and gets a worse result here than plain links do: this is navigation,
 * not a command palette.
 *
 * The JavaScript below is enhancement and nothing depends on it. It adds the
 * two things `<details>` does not do on its own — close on Escape, close when
 * you click elsewhere — because a menu that stays open after you have moved on
 * is a menu that covers what you moved on to.
 */
export function AccountMenu({ name, signOut }: { name: string; signOut: () => Promise<void> }) {
  const root = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (): void => {
      if (root.current?.open) root.current.open = false;
    };

    const onPointerDown = (event: MouseEvent): void => {
      if (!root.current?.open) return;
      if (event.target instanceof Node && root.current.contains(event.target)) return;
      close();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !root.current?.open) return;
      close();
      // Back to the trigger, not to the top of the document. Escaping a menu
      // and losing your place in the page is worse than the menu staying open.
      root.current.querySelector('summary')?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <details className="account" ref={root}>
      <summary>
        <span>{name}</span>
        <span className="account-caret" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="account-menu">
        <a href="/settings">Settings</a>
        <form action={signOut}>
          <button className="account-signout" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
