import { redirect } from 'next/navigation';
import { API_URL, currentUser } from '../../lib/api';
import { AuthShell } from '../../components/AuthShell';

export const dynamic = 'force-dynamic';

/**
 * Two ways in: Google, or a link by email.
 *
 * Both are server actions rather than client-side fetches, so no token or
 * OAuth state ever passes through browser JavaScript, and the page works
 * without it.
 */
/**
 * What went wrong, in words a person can act on.
 *
 * The landing routes redirect here with a code rather than rendering their own
 * error page, so every failure arrives somewhere with a way forward on it.
 */
const MESSAGES: Record<string, string> = {
  cancelled: 'You did not finish signing in with Google. Nothing was changed.',
  google: 'Google sign-in is unavailable right now. Try a link by email.',
  'google-failed':
    'That Google sign-in could not be completed. It may have taken too long, or been used already.',
  link:
    'That sign-in link did not work. Links work once and expire after fifteen minutes, and some ' +
    'email apps open them before you do, which uses them up. Ask for a new one below.',
  incomplete: 'That link was incomplete. Ask for a new one below.',
  email: 'Enter an email address to get a sign-in link.',
  default: 'Something went wrong signing you in. Try again below.',
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  if (await currentUser()) redirect('/logbook');
  const { sent, error } = await searchParams;

  async function startGoogle(): Promise<void> {
    'use server';
    const response = await fetch(`${API_URL}/v1/auth/oauth/google/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    });
    if (!response.ok) redirect('/signin?error=google');
    const { authorizationUrl } = (await response.json()) as { authorizationUrl: string };
    redirect(authorizationUrl);
  }

  async function sendLink(formData: FormData): Promise<void> {
    'use server';
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect('/signin?error=email');

    await fetch(`${API_URL}/v1/auth/email/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
    // Always the same answer, whatever the API said. It answers 204 for every
    // address so that a stranger cannot use this form to find out who has an
    // account, and a UI that reported "no such account" would give that away.
    redirect('/signin?sent=1');
  }

  return (
    <AuthShell title="Sign in to MyDiveLog">
      {sent && (
        <p className="notice">
          If that address has an account, a sign-in link is on its way. It works once and expires in
          fifteen minutes.
        </p>
      )}
      {error && <p className="notice bad">{MESSAGES[error] ?? MESSAGES['default']}</p>}

      <form action={startGoogle}>
        <button className="button primary" type="submit">
          Continue with Google
        </button>
      </form>

      <div className="divider">
        <span>or</span>
      </div>

      <form action={sendLink} className="stack">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
        <button className="button" type="submit">
          Email me a sign-in link
        </button>
      </form>

      <p className="muted small">
        No password to forget. Signing in creates an account if you do not have one.
      </p>
    </AuthShell>
  );
}
