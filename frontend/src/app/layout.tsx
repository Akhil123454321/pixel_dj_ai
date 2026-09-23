import type { Metadata } from "next";
import SessionProvider from "@/components/SessionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ours, a little archive",
  description: "A shared shelf for books and mixtapes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
