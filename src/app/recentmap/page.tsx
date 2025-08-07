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
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center p-8">
          <div className="text-lg text-gray-700">
            Loading your recent activities...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center p-8">
          <div className="text-lg text-red-500">
            Error loading activities: {error.message}
          </div>
        </div>
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center p-8">
          <div className="text-lg text-gray-700">No activities found.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">
          Recent Activities Map
        </h1>
        <Link
          href="/"
          className="rounded-lg bg-gray-100 px-4 py-2 font-semibold text-gray-700 no-underline transition hover:bg-gray-200"
        >
          ← Back to Dashboard
        </Link>
      </div>

      <div className="flex flex-col gap-6 lg:h-[600px] lg:flex-row">
        <div className="lg:w-1/3">
          <StravaActivityList
            activities={activities}
            onFilterChange={setFilteredActivities}
          />
        </div>
        <div className="lg:w-2/3">
          <StravaActivityMap activities={filteredActivities} />
        </div>
      </div>
    </div>
  );
}
