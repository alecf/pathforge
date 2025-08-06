"use client";

import { type DetailedActivityResponse } from "strava-v3";
import { api } from "~/trpc/react";

interface ActivityCardProps {
  activity: DetailedActivityResponse;
}

function ActivityCard({ activity }: ActivityCardProps) {
  return (
    <div className="rounded-lg bg-white/10 p-4 transition-colors hover:bg-white/20">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white">{activity.name}</h3>
          <p className="text-sm text-gray-300">
            {activity.sport_type} •{" "}
            {new Date(activity.start_date).toLocaleDateString()}
          </p>
          <div className="mt-2 flex gap-4 text-sm text-gray-300">
            {activity.distance && (
              <span>Distance: {(activity.distance / 1000).toFixed(2)} km</span>
            )}
            {activity.moving_time && (
              <span>Duration: {Math.round(activity.moving_time / 60)} min</span>
            )}
            {activity.average_speed && (
              <span>
                Avg Speed: {(activity.average_speed * 3.6).toFixed(1)} km/h
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          {activity.distance && (
            <>
              <div className="text-2xl font-bold text-white">
                {(activity.distance / 1000).toFixed(1)}
              </div>
              <div className="text-xs text-gray-300">km</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function StravaDashboard() {
  const {
    data: activities,
    isLoading,
    error,
  } = api.strava.athlete.listActivities.useQuery({
    per_page: 10,
  });

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
    <div className="mx-auto w-full max-w-4xl p-6">
      <h2 className="mb-6 text-2xl font-bold text-white">
        Your Recent Activities
      </h2>
      <div className="grid gap-4">
        {activities.map((activity) => (
          <ActivityCard key={activity.id} activity={activity} />
        ))}
      </div>
    </div>
  );
}
