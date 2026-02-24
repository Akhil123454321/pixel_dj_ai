import type { Metadata } from "next";
import SessionProvider from "@/components/SessionProvider";
import { SpotifyPlayerProvider } from "@/context/SpotifyPlayerContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIXEL DJ",
  description: "AI-powered Spotify DJ with pastel pixel aesthetics",
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
          <SpotifyPlayerProvider>{children}</SpotifyPlayerProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
