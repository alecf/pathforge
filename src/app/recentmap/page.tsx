"use client";

import Link from "next/link";
import { useState } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import { StravaActivityList } from "~/app/_components/StravaActivityList";
import { StravaActivityMap } from "~/app/_components/StravaActivityMap";
import { api } from "~/trpc/react";

export default function RecentMapPage() {
  const {
    data: activities,
    isLoading,
    error,
  } = api.strava.athlete.listActivities.useQuery({
    per_page: 10,
  });

  const [filteredActivities, setFilteredActivities] = useState<
    DetailedActivityResponse[]
  >([]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-lg">Loading your recent activities...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-lg text-red-500">
          Error loading activities: {error.message}
        </div>
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-lg">No activities found.</div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Recent Activities Map</h1>
        <Link
          href="/"
          className="rounded-lg bg-white/10 px-4 py-2 font-semibold no-underline transition hover:bg-white/20"
        >
          ← Back to Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <StravaActivityList
            activities={activities}
            onFilterChange={setFilteredActivities}
          />
        </div>
        <div className="lg:col-span-2">
          <StravaActivityMap activities={filteredActivities} />
        </div>
      </div>
    </div>
  );
}
