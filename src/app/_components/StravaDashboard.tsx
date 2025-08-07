"use client";

import { type DetailedActivityResponse } from "strava-v3";
import { useActivities } from "./StravaActivityMapUtils";

interface ActivityCardProps {
  activity: DetailedActivityResponse;
}

function ActivityCard({ activity }: ActivityCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:shadow-md">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">
            {activity.name}
          </h3>
          <p className="text-sm text-gray-600">
            {activity.sport_type} •{" "}
            {new Date(activity.start_date).toLocaleDateString()}
          </p>
          <div className="mt-2 flex gap-4 text-sm text-gray-600">
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
            {activity.total_elevation_gain && (
              <span>
                Elevation: {activity.total_elevation_gain.toFixed(0)} m
              </span>
            )}
          </div>
          {/* Show additional details if available from detailed activity data */}
          {activity.map?.summary_polyline && (
            <p className="mt-1 text-xs text-green-600">Route data available</p>
          )}
        </div>
        <div className="text-right">
          {activity.distance && (
            <>
              <div className="text-2xl font-bold text-orange-600">
                {(activity.distance / 1000).toFixed(1)}
              </div>
              <div className="text-xs text-gray-500">km</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const activityParams = {
  per_page: 3,
};
export function StravaDashboard() {
  const { activities, isLoading, error, detailErrors, isLoadingDetails } =
    useActivities(activityParams);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-lg text-gray-700">
          Loading your recent activities...
        </div>
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
        <div className="text-lg text-gray-700">No activities found.</div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <h2 className="mb-6 text-2xl font-bold text-gray-900">
        Your Recent Activities
      </h2>

      {isLoadingDetails && (
        <div className="mb-4 rounded bg-blue-50 p-3 text-sm text-blue-700">
          Loading detailed activity data...
        </div>
      )}

      {detailErrors.length > 0 && (
        <div className="mb-4 rounded bg-yellow-50 p-3 text-sm text-yellow-700">
          Some activity details failed to load ({detailErrors.length} errors)
        </div>
      )}

      <div className="grid gap-4">
        {activities?.map((activity) => (
          <ActivityCard key={activity.id} activity={activity} />
        ))}
      </div>
    </div>
  );
}
