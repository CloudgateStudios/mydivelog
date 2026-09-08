import { redirect } from 'next/navigation';
import { clearSession } from '../lib/session';
import { AccountMenu } from './AccountMenu';
import { Wordmark } from './Wordmark';

export function AppHeader({ user }: { user: { email: string; displayName: string | null } }) {
  async function signOut(): Promise<void> {
    'use server';
    await clearSession();
    redirect('/signin');
  }

  return (
    <header className="nav">
      {/* The bar is full bleed; its contents sit in the same shell as the page,
          so the brand lines up with the first heading rather than with the
          window's edge. */}
      <div className="nav-inner">
        <Wordmark href="/logbook" />
        <nav>
          <a href="/logbook">Logbook</a>
          <a href="/trips">Trips</a>
          <a href="/sites">Sites</a>
          <a href="/gear">Gear</a>
          <a href="/stats">Stats</a>
          <a href="/import">Import</a>
        </nav>
        {/* Settings and sign out live in here now, which is where a person
            looks for them: under their own name, at the end of the bar. */}
        <AccountMenu name={user.displayName ?? user.email} signOut={signOut} />
      </div>
    </header>
  );
}
