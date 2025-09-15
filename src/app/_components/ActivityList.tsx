"use client";

import { useState } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import { sportTypeTitles } from "~/types/sportTypeTitles";

// Helper function to convert meters to miles
function metersToMiles(meters: number): number {
  return meters / 1609.34;
}

interface ActivityListProps {
  activities: DetailedActivityResponse[];
  onFilterChange: (filteredActivities: DetailedActivityResponse[]) => void;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
}

export function ActivityList({
  activities,
  onFilterChange,
  onLoadMore,
  isLoadingMore,
}: ActivityListProps) {
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
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-shrink-0 items-center justify-between">
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activities.map((activity) => {
          const isSelected = selectedActivities.has(activity.id.toString());
          const hasMap = !!(
            activity.map?.polyline ?? activity.map?.summary_polyline
          );

          return (
            <div
              key={activity.id}
              className={`mb-2 cursor-pointer rounded p-3 transition-colors hover:shadow-sm ${
                isSelected
                  ? "border border-orange-200 bg-orange-50"
                  : "border border-gray-100 bg-gray-50 hover:bg-gray-100"
              }`}
              onClick={() =>
                handleActivityToggle(activity.id.toString(), !isSelected)
              }
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    e.stopPropagation(); // Prevent card click when clicking checkbox
                    handleActivityToggle(
                      activity.id.toString(),
                      e.target.checked,
                    );
                  }}
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
                    {sportTypeTitles[activity.sport_type]} •{" "}
                    {new Date(activity.start_date).toLocaleDateString()}
                  </p>
                  {activity.distance !== undefined && (
                    <p className="text-xs text-green-600">
                      {metersToMiles(activity.distance).toFixed(2)} mi
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
        <div>
          {selectedActivities.size} of {activities.length} activities selected
        </div>
        <div className="flex items-center gap-2">
          <span>
            {activities.length} of {activities.length} activities
          </span>
          {onLoadMore && (
            <button
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="rounded bg-gray-100 px-3 py-1 text-sm text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              {isLoadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
