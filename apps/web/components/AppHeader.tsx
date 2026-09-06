import { clearSession } from '../lib/session';
import { Wordmark } from './Wordmark';
import { redirect } from 'next/navigation';

export function AppHeader({ user }: { user: { email: string; displayName: string | null } }) {
  async function signOut(): Promise<void> {
    'use server';
    await clearSession();
    redirect('/signin');
  }

  return (
    <header className="nav">
      <Wordmark href="/logbook" />
      <nav>
        <a href="/logbook">Logbook</a>
        <a href="/trips">Trips</a>
        <a href="/sites">Sites</a>
        <a href="/gear">Gear</a>
        <a href="/stats">Stats</a>
        <a href="/import">Import</a>
        <a href="/settings">Settings</a>
      </nav>
      <span className="muted">{user.displayName ?? user.email}</span>
      <form action={signOut} style={{ marginLeft: 'auto' }}>
        <button className="link" type="submit">
          Sign out
        </button>
      </form>
    </header>
  );
}
