import type { ReactNode } from 'react';

export const metadata = {
  title: 'MyDiveLog Admin',
  description: 'Staff tools for MyDiveLog.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
