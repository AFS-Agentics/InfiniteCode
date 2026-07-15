import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Devo",
  description: "Documentation for the Devo coding agent.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col antialiased">
        {children}
      </body>
    </html>
  );
}
