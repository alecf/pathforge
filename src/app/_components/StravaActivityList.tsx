"use client";

import { useState } from "react";
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
    <div className="mb-6 rounded-lg bg-white/10 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Activities</h3>
        <div className="flex gap-2">
          <button
            onClick={handleSelectAll}
            className="rounded bg-white/20 px-3 py-1 text-sm text-white hover:bg-white/30"
          >
            Select All
          </button>
          <button
            onClick={handleSelectNone}
            className="rounded bg-white/20 px-3 py-1 text-sm text-white hover:bg-white/30"
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
                isSelected ? "bg-white/20" : "bg-white/5"
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
                    <h4 className="font-medium text-white">{activity.name}</h4>
                    {!hasMap && (
                      <span className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-300">
                        No route data
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-300">
                    {activity.sport_type} •{" "}
                    {new Date(activity.start_date).toLocaleDateString()}
                  </p>
                  {startLocation && (
                    <p className="text-xs text-gray-400">
                      Start: {startLocation[0]?.toFixed(4)},{" "}
                      {startLocation[1]?.toFixed(4)}
                    </p>
                  )}
                  {endLocation && (
                    <p className="text-xs text-gray-400">
                      End: {endLocation[0]?.toFixed(4)},{" "}
                      {endLocation[1]?.toFixed(4)}
                    </p>
                  )}
                  {hasMap && (
                    <p className="text-xs text-green-400">
                      Route: {activity.map?.summary_polyline?.length ?? 0} chars
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-sm text-gray-300">
        {selectedActivities.size} of {activities.length} activities selected
      </div>
    </div>
  );
}
