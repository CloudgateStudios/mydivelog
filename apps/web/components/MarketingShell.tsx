import type { ReactNode } from 'react';
import { Wordmark } from './Wordmark';

/**
 * The public site's frame.
 *
 * One nav and one footer for six pages, so a link added here appears
 * everywhere rather than on the five pages somebody remembered.
 */
export function MarketingShell({
  user,
  children,
}: {
  user: { email: string } | undefined;
  children: ReactNode;
}) {
  return (
    <>
      <header className="nav">
        {/* Same shell as the page below, so the brand sits above the headline
            rather than out at the window's edge. See `.nav-inner`. */}
        <div className="nav-inner nav-marketing">
          <Wordmark href="/" />
          <nav>
            <a href="/formats">Formats</a>
            <a href="/docs">How it works</a>
            <a href="/pricing">Pricing</a>
          </nav>
          <a className="button small" href={user ? '/logbook' : '/signin'}>
            {user ? 'Your logbook' : 'Sign in'}
          </a>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="landing">
        {children}
      </main>

      <footer className="site-footer">
        <Wordmark href="/" size={18} />
        <nav aria-label="Legal and reference">
          <a href="/formats">Supported formats</a>
          <a href="/docs">Documentation</a>
          <a href="/pricing">Pricing</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/terms">Terms</a>
        </nav>
        <span className="muted">Not a dive computer. No in-water guidance.</span>
      </footer>
    </>
  );
}
