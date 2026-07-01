import type { Metadata } from "next";

import "./styles.css";

export const metadata: Metadata = {
  title: "MyDiveLog Admin",
  description: "Staff operations console for MyDiveLog."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
