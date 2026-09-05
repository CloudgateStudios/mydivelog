import type { ReactNode } from 'react';

/** The frame every sign-in message shares, so none of them is a bare error. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="auth">
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
