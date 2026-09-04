import type { ReactNode } from 'react';

export const metadata = {
  title: 'MyDiveLog',
  description: 'One logbook for every dive.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
