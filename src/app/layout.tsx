import "~/styles/globals.css";

import { type Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { Geist } from "next/font/google";

import { TRPCReactProvider } from "~/trpc/react";
import { AppHeader } from "./_components/AppHeader";

export const metadata: Metadata = {
  title: "Strava Raceways",
  description: "Track your Strava activities and raceways",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <body>
        <SessionProvider>
          <TRPCReactProvider>
            <div className="min-h-screen bg-gray-50">
              <AppHeader />
              <main className="flex-1">{children}</main>
            </div>
          </TRPCReactProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
