import type { ReactNode } from 'react';
/* Self-hosted; the panel's CSP allows font-src 'self' and nothing else. */
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-serif/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './globals.css';
import { Wordmark } from '../components/Wordmark';

export const metadata = {
  title: 'MyDiveLog Admin',
  description: 'Staff tools for MyDiveLog.',
};

const NAV = [
  ['/', 'Overview'],
  ['/imports', 'Imports'],
  ['/health', 'Format health'],
  ['/dives', 'Dives'],
  ['/sites', 'Sites'],
  ['/site-names', 'Site names'],
  ['/tags', 'Tags'],
  ['/users', 'Users'],
  ['/audit', 'Audit'],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Wordmark />
          <nav>
            {NAV.map(([href, label]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
            {process.env['APP_ENV'] ?? 'local'}
          </span>
        </header>
        {children}
      </body>
    </html>
  );
}
