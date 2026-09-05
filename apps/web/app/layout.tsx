import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'MyDiveLog',
  description: 'Every dive you have logged, in one place.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
