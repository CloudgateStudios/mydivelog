import type { ReactNode } from 'react';
import { Wordmark } from './Wordmark';

/** The frame every sign-in message shares, so none of them is a bare error. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <main id="main" tabIndex={-1} className="auth">
        <div className="card">
          <h1>{title}</h1>
          {children}
        </div>
      </main>

      {/*
        The same footer the public pages carry. This is the screen where someone
        decides to hand over a decade of dives, so it is the last place the
        boundary should go unsaid — and the privacy and terms links belong
        within reach of the button that creates the account.
      */}
      <footer className="site-footer">
        <Wordmark href="/" size={18} />
        <nav aria-label="Legal and reference">
          <a href="/formats">Supported formats</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/terms">Terms</a>
        </nav>
        <span className="muted">Not a dive computer. No in-water guidance.</span>
      </footer>
    </>
  );
}
