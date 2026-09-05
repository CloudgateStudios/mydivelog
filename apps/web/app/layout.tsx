import type { ReactNode } from 'react';
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
