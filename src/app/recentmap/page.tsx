"use client";

import { useEffect, useRef, useState } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import { ActivityList } from "../_components/ActivityList";
import { ActivityMapTabs } from "../_components/ActivityMapTabs";
import {
  useActivities,
  type ActivityWithStreams,
} from "../_components/ActivityMapUtils";

const activityParams = {
  per_page: 10,
};
export default function RecentMapPage() {
  const { activities, isLoading, error, detailErrors, isLoadingDetails } =
    useActivities(activityParams);

  const [filteredActivities, setFilteredActivities] = useState<
    (DetailedActivityResponse | ActivityWithStreams)[]
  >([]);

  // Initialize filtered activities once when activities first load to avoid
  // overwriting user's selections when data updates (e.g., streams resolve)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && activities && activities.length > 0) {
      setFilteredActivities(activities);
      initializedRef.current = true;
    }
  }, [activities]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-lg text-gray-700">Loading activities...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-lg text-red-500">
          Error loading activities: {error.message}
        </div>
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-lg text-gray-700">No activities found.</div>
      </div>
    );
  }

  return (
    <>
      <div className="w-80 flex-shrink-0 overflow-y-auto">
        <ActivityList
          activities={activities}
          onFilterChange={setFilteredActivities}
        />
      </div>
      <div className="relative flex-1">
        {isLoadingDetails && (
          <div className="absolute top-4 right-4 z-10 rounded bg-blue-50 p-3 text-sm text-blue-700">
            Loading detailed activity data...
          </div>
        )}
        {detailErrors.length > 0 && (
          <div className="absolute top-4 right-4 z-10 rounded bg-yellow-50 p-3 text-sm text-yellow-700">
            Some activity details failed to load ({detailErrors.length} errors)
          </div>
        )}
        <ActivityMapTabs activities={filteredActivities} />
      </div>
    </>
  );
}
