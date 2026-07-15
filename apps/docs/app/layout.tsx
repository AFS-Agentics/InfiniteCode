import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InfiniteCode",
  description: "Documentation for the InfiniteCode coding agent.",
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
