import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'MyDiveLog Admin',
  description: 'Staff tools for MyDiveLog.',
};

const NAV = [
  ['/', 'Overview'],
  ['/imports', 'Imports'],
  ['/dives', 'Dives'],
  ['/sites', 'Sites'],
  ['/tags', 'Tags'],
  ['/users', 'Users'],
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <strong>MyDiveLog Admin</strong>
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
