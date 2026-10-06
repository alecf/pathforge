"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { DetailedActivity } from "strava-v3";
import { ActivityList } from "../_components/ActivityList";
import { ActivityMapTabs } from "../_components/ActivityMapTabs";
import {
  useActivitiesPages,
  type ActivityWithStreams,
} from "../_components/ActivityMapUtils";

const PER_PAGE = 10 as const;
export default function RecentMapPage() {
  const [pages, setPages] = useState(1);

  const {
    activities,
    isLoading,
    error,
    detailErrors,
    isLoadingDetails,
    isLoadingBasic,
  } = useActivitiesPages({ per_page: PER_PAGE, pageCount: pages });

  const [filteredActivities, setFilteredActivities] = useState<
    (DetailedActivity | ActivityWithStreams)[]
  >([]);

  // Initialize filtered activities once when activities first load to avoid
  // overwriting user's selections when data updates (e.g., streams resolve)
  const initializedRef = useRef(false);
  const lastToastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initializedRef.current && activities && activities.length > 0) {
      setFilteredActivities(activities);
      initializedRef.current = true;
    }
  }, [activities]);

  // Toast detailErrors using Sonner
  useEffect(() => {
    if (detailErrors.length === 0) return;

    const messages = detailErrors.map((e) =>
      e instanceof Error ? e.message : String(e),
    );
    const key = messages.join("|");
    if (lastToastKeyRef.current === key) return;
    lastToastKeyRef.current = key;

    toast("Some activity details failed to load", {
      description: (
        <ul className="list-disc pl-5 text-gray-800">
          {messages.map((m, idx) => (
            <li key={idx} className="truncate">
              {m}
            </li>
          ))}
        </ul>
      ),
    });
  }, [detailErrors]);

  const hasActivities = !!activities && activities.length > 0;

  return (
    <>
      <div className="w-80 flex-shrink-0 overflow-y-auto">
        {hasActivities ? (
          <ActivityList
            // Mount only when activities are present so default selection = all
            key={`list-${activities.length}`}
            activities={activities}
            onFilterChange={setFilteredActivities}
            onLoadMore={() => setPages((p) => p + 1)}
            isLoadingMore={isLoadingBasic}
          />
        ) : (
          <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Activities
              </h3>
            </div>

            {error && (
              <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                Error loading activities: {error.message}
              </div>
            )}

            {isLoading && (
              <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-2 text-sm text-blue-700">
                Loading activities...
              </div>
            )}

            <div className="flex flex-1 items-center justify-center text-sm text-gray-600">
              {isLoading
                ? "Fetching your recent activities…"
                : "No activities to display."}
            </div>
          </div>
        )}
      </div>
      <div className="relative flex-1">
        {isLoadingBasic && (
          <div className="absolute top-4 right-4 z-10 rounded bg-blue-50 p-3 text-sm text-blue-700">
            Loading activities...
          </div>
        )}
        {isLoadingDetails && (
          <div className="absolute top-4 right-4 z-10 mt-12 rounded bg-blue-50 p-3 text-sm text-blue-700">
            Loading detailed activity data...
          </div>
        )}
        {/* Errors are surfaced via Sonner toasts */}
        <ActivityMapTabs activities={filteredActivities} />
      </div>
    </>
  );
}
