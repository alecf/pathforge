"use client";

import { useEffect, useState } from "react";
import { type DetailedActivityResponse } from "strava-v3";

interface StravaActivityListProps {
  activities: DetailedActivityResponse[];
  onFilterChange: (filteredActivities: DetailedActivityResponse[]) => void;
}

export function StravaActivityList({
  activities,
  onFilterChange,
}: StravaActivityListProps) {
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(
    new Set(activities.map((a) => a.id.toString())),
  );

  // Update selected activities when the activities prop changes
  useEffect(() => {
    if (activities.length > 0) {
      const allIds = new Set(activities.map((a) => a.id.toString()));
      setSelectedActivities(allIds);
      onFilterChange(activities);
    }
  }, [activities, onFilterChange]);

  const handleActivityToggle = (activityId: string, checked: boolean) => {
    const newSelected = new Set(selectedActivities);
    if (checked) {
      newSelected.add(activityId);
    } else {
      newSelected.delete(activityId);
    }
    setSelectedActivities(newSelected);

    const filteredActivities = activities.filter((a) =>
      newSelected.has(a.id.toString()),
    );
    onFilterChange(filteredActivities);
  };

  const handleSelectAll = () => {
    const allIds = new Set(activities.map((a) => a.id.toString()));
    setSelectedActivities(allIds);
    onFilterChange(activities);
  };

  const handleSelectNone = () => {
    setSelectedActivities(new Set());
    onFilterChange([]);
  };

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Activities</h3>
        <div className="flex gap-2">
          <button
            onClick={handleSelectAll}
            className="rounded bg-orange-100 px-3 py-1 text-sm text-orange-700 hover:bg-orange-200"
          >
            Select All
          </button>
          <button
            onClick={handleSelectNone}
            className="rounded bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-gray-200"
          >
            Select None
          </button>
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {activities.map((activity) => {
          const isSelected = selectedActivities.has(activity.id.toString());
          const hasMap = !!activity.map?.summary_polyline;
          const startLocation = activity.start_latlng;
          const endLocation = activity.end_latlng;

          return (
            <div
              key={activity.id}
              className={`mb-2 rounded p-3 transition-colors ${
                isSelected
                  ? "border border-orange-200 bg-orange-50"
                  : "border border-gray-100 bg-gray-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) =>
                    handleActivityToggle(
                      activity.id.toString(),
                      e.target.checked,
                    )
                  }
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-gray-900">
                      {activity.name}
                    </h4>
                    {!hasMap && (
                      <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700">
                        No route data
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">
                    {activity.sport_type} •{" "}
                    {new Date(activity.start_date).toLocaleDateString()}
                  </p>
                  {startLocation && (
                    <p className="text-xs text-gray-500">
                      Start: {startLocation[0]?.toFixed(4)},{" "}
                      {startLocation[1]?.toFixed(4)}
                    </p>
                  )}
                  {endLocation && (
                    <p className="text-xs text-gray-500">
                      End: {endLocation[0]?.toFixed(4)},{" "}
                      {endLocation[1]?.toFixed(4)}
                    </p>
                  )}
                  {hasMap && (
                    <p className="text-xs text-green-600">
                      Route: {activity.map?.summary_polyline?.length ?? 0} chars
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-sm text-gray-600">
        {selectedActivities.size} of {activities.length} activities selected
      </div>
    </div>
  );
}
