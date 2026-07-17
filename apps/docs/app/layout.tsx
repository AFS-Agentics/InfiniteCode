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
      <head>
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2935929946447260"
          crossOrigin="anonymous"
        />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        {children}
      </body>
    </html>
  );
}
