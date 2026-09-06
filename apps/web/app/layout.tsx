import type { ReactNode } from 'react';
/*
 * IBM Plex, self-hosted. The Content-Security-Policy allows `font-src 'self'`,
 * so a font CDN would be blocked — which is the right constraint anyway: these
 * are served from our own origin, tell Google nothing, and the latin subsets of
 * the four faces we use come to about 80 KB in total.
 */
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-serif/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './globals.css';

export const metadata = {
  title: 'MyDiveLog',
  description: 'Every dive you have logged, in one place.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/*
          The first focusable element on every page. Without it, reaching the
          first dive on the log means tabbing through the whole header — on
          every page, every time. `tabIndex={-1}` on the target is what lets
          focus actually land there; a bare #main anchor moves the scroll
          position and leaves the caret in the navigation.
        */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
