import Link from "next/link";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";
import { StravaDashboard } from "./_components/StravaDashboard";

export default async function Home() {
  const hello = await api.hello({ text: "from tRPC" });
  const session = await auth();

  return (
    <HydrateClient>
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-center gap-12">
          <h1 className="text-center text-5xl font-extrabold tracking-tight sm:text-[5rem]">
            Strava <span className="text-orange-600">Raceways</span>
          </h1>

          {session ? (
            <div className="w-full max-w-4xl">
              <div className="mb-6 flex justify-center gap-4">
                <Link
                  href="/recentmap"
                  className="rounded-lg bg-orange-600 px-6 py-3 font-semibold text-white no-underline transition hover:bg-orange-700"
                >
                  View Activity Map
                </Link>
              </div>
              <StravaDashboard />
            </div>
          ) : (
            <div className="text-center">
              <p className="mb-8 text-xl text-gray-600">
                Connect your Strava account to start tracking your activities
                and raceways.
              </p>
              <Link
                href="/api/auth/signin"
                className="inline-flex items-center rounded-md border border-transparent bg-orange-600 px-6 py-3 text-base font-medium text-white hover:bg-orange-700 focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:outline-none"
              >
                Sign in with Strava
              </Link>
            </div>
          )}

          <div className="flex flex-col items-center gap-2">
            <p className="text-2xl text-gray-700">
              {hello ? hello.greeting : "Loading tRPC query..."}
            </p>

            {session && (
              <p className="text-center text-lg text-gray-600">
                Logged in as {session.user?.name}
              </p>
            )}
          </div>
        </div>
      </div>
    </HydrateClient>
  );
}
