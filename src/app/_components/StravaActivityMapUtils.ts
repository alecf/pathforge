import polyline from "@mapbox/polyline";
import * as d3 from "d3";
import { useCallback, useMemo } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import { api } from "~/trpc/react";
import { useStable } from "~/util/useStable";

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  minElevation?: number;
  maxElevation?: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
  lat: number;
  lng: number;
  elevation: number;
}

export interface ProjectedActivity {
  id: string;
  name: string;
  points: ProjectedPoint[];
  color: string;
}

/**
 * Calculate bounding box for all activities including elevation
 * @param activities Array of Strava activities (can be basic or detailed)
 * @returns BoundingBox with min/max lat/lng/elevation values
 */
export function calculateBoundingBox(
  activities: DetailedActivityResponse[],
): BoundingBox {
  if (!activities.length) {
    return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minElevation = Infinity;
  let maxElevation = -Infinity;

  activities.forEach((activity) => {
    if (activity.map?.summary_polyline) {
      // Use detailed elevation data if available, otherwise use basic polyline
      const points = decodePolyline(
        activity.map.summary_polyline,
        activity.map?.summary_polyline ? undefined : undefined, // Will be updated to use detailed data
      );
      points.forEach((point) => {
        minLat = Math.min(minLat, point.lat);
        maxLat = Math.max(maxLat, point.lat);
        minLng = Math.min(minLng, point.lng);
        maxLng = Math.max(maxLng, point.lng);

        // Include elevation if available
        if (point.elevation !== undefined) {
          minElevation = Math.min(minElevation, point.elevation);
          maxElevation = Math.max(maxElevation, point.elevation);
        }
      });
    } else {
      console.log(`Activity ${activity.id}: No polyline data`);
    }
  });

  // Check if we have valid coordinates
  if (
    minLat === Infinity ||
    maxLat === -Infinity ||
    minLng === Infinity ||
    maxLng === -Infinity
  ) {
    return { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };
  }

  // Add padding to the bounding box
  const latPadding = (maxLat - minLat) * 0.1;
  const lngPadding = (maxLng - minLng) * 0.1;

  const result: BoundingBox = {
    minLat: minLat - latPadding,
    maxLat: maxLat + latPadding,
    minLng: minLng - lngPadding,
    maxLng: maxLng + lngPadding,
  };

  // Include elevation bounds if we have elevation data
  if (minElevation !== Infinity && maxElevation !== -Infinity) {
    result.minElevation = minElevation;
    result.maxElevation = maxElevation;
  }

  return result;
}

/**
 * Decode Google's polyline format to array of lat/lng/elevation points
 * @param encoded Encoded polyline string from Strava
 * @param elevationData Optional elevation data array from detailed activity
 * @returns Array of lat/lng/elevation coordinates
 */
export function decodePolyline(
  encoded: string,
  elevationData?: number[],
): Array<{ lat: number; lng: number; elevation?: number }> {
  try {
    // Use the reliable Mapbox polyline decoder
    const decoded = polyline.decode(encoded);

    // Convert from [lat, lng] arrays to {lat, lng, elevation} objects
    const points = decoded.map(([lat, lng], index) => ({
      lat,
      lng,
      elevation: elevationData?.[index],
    }));

    return points;
  } catch (error) {
    console.error("Error decoding polyline:", error);
    return [];
  }
}

/**
 * Get the best available route data for an activity
 * Prioritizes detailed activity data over basic activity data
 */
export function getActivityRouteData(activity: DetailedActivityResponse) {
  // If we have detailed activity data with elevation points, use that
  if (activity.map?.summary_polyline && activity.map?.summary_polyline) {
    // For now, we'll use the basic polyline. In a full implementation,
    // you'd want to check if this is a detailed activity with elevation data
    const points = decodePolyline(activity.map.summary_polyline);
    return points;
  }

  return [];
}

/**
 * Create a D3 projection that fits the actual route points to the given dimensions
 * @param activities Array of Strava activities with decoded polylines
 * @param width Width of the container
 * @param height Height of the container
 * @returns D3 geo projection
 */
export function createProjection(
  activities: DetailedActivityResponse[],
  width: number,
  height: number,
) {
  // Get all route points from all activities
  const allPoints: Array<[number, number]> = [];

  activities.forEach((activity) => {
    const routeData = getActivityRouteData(activity);
    routeData.forEach((point) => {
      allPoints.push([point.lng, point.lat]);
    });
  });

  if (allPoints.length === 0) {
    return d3
      .geoMercator()
      .center([0, 0])
      .scale(100)
      .translate([width / 2, height / 2]);
  }

  // Calculate bounds from actual route points
  const lngs = allPoints.map((p) => p[0]);
  const lats = allPoints.map((p) => p[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  // Calculate center
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  // Create a GeoJSON feature collection from the actual route points
  const routeFeature = {
    type: "Feature" as const,
    geometry: {
      type: "MultiPoint" as const,
      coordinates: allPoints,
    },
    properties: {},
  };

  // Start with a strawman projection
  let scale = 1;
  let offset: [number, number] = [0, 0];

  let projection = d3
    .geoAlbers()
    .center([centerLng, centerLat])
    .parallels([minLat, maxLat])
    .scale(scale)
    .translate(offset);

  // Create a path generator to test the projection
  const path = d3.geoPath().projection(projection);
  const bounds = path.bounds(routeFeature);

  // Calculate optimal scale and offset based on the projected bounds
  scale =
    0.95 /
    Math.max(
      (bounds[1][0] - bounds[0][0]) / width,
      (bounds[1][1] - bounds[0][1]) / height,
    );

  offset = [
    (width - scale * (bounds[1][0] + bounds[0][0])) / 2,
    (height - scale * (bounds[1][1] + bounds[0][1])) / 2,
  ];

  // Create the final projection with optimal parameters
  projection = d3
    .geoAlbers()
    .center([centerLng, centerLat])
    .parallels([minLat, maxLat])
    .scale(scale)
    .translate(offset);

  return projection;
}

/**
 * Project activities to x/y/z coordinates using the given projection
 * @param activities Array of Strava activities
 * @param projection D3 geo projection
 * @returns Array of projected activities with x/y/z coordinates
 */
export function projectActivities(
  activities: DetailedActivityResponse[],
  projection: d3.GeoProjection,
): ProjectedActivity[] {
  const colors = d3.schemeCategory10;

  // Calculate elevation bounds across all activities
  let minElevation = Infinity;
  let maxElevation = -Infinity;
  let hasElevationData = false;

  // First pass: collect elevation data to determine bounds
  activities.forEach((activity) => {
    const routeData = getActivityRouteData(activity);

    // Check if we have actual elevation data from detailed activity
    const hasDetailedElevation = routeData.some(
      (point) => point.elevation !== undefined,
    );

    if (hasDetailedElevation) {
      routeData.forEach((point) => {
        if (point.elevation !== undefined) {
          minElevation = Math.min(minElevation, point.elevation);
          maxElevation = Math.max(maxElevation, point.elevation);
          hasElevationData = true;
        }
      });
    } else if (
      activity.total_elevation_gain &&
      activity.total_elevation_gain > 0
    ) {
      // Fallback to total elevation gain if no detailed elevation data
      minElevation = Math.min(minElevation, 0); // Start at sea level
      maxElevation = Math.max(maxElevation, activity.total_elevation_gain);
      hasElevationData = true;
    }
  });

  // If no elevation data, use fallback values
  if (!hasElevationData) {
    minElevation = 0;
    maxElevation = 100;
  }

  return activities
    .filter(
      (
        activity,
      ): activity is DetailedActivityResponse & {
        map: { summary_polyline: string };
      } => Boolean(activity.map?.summary_polyline),
    )
    .map((activity, index) => {
      const routeData = getActivityRouteData(activity);

      if (routeData.length === 0) {
        return null;
      }

      const projectedPoints = routeData.map((point, pointIndex) => {
        const projected = projection([point.lng, point.lat]);
        const [x, y] = projected ?? [0, 0];

        // Project elevation to z coordinate
        let z = 0;
        if (hasElevationData) {
          if (point.elevation !== undefined) {
            // Use actual elevation data from detailed activity
            z =
              ((point.elevation - minElevation) /
                (maxElevation - minElevation)) *
              100;
          } else if (
            activity.total_elevation_gain &&
            activity.total_elevation_gain > 0
          ) {
            // Fallback to estimated elevation based on total elevation gain
            const progress = pointIndex / (routeData.length - 1);
            const elevation =
              activity.total_elevation_gain * Math.sin(progress * Math.PI);
            z =
              ((elevation - minElevation) / (maxElevation - minElevation)) *
              100;
          }
        }

        return {
          x,
          y,
          z,
          lat: point.lat,
          lng: point.lng,
          elevation:
            point.elevation ??
            (activity.total_elevation_gain
              ? activity.total_elevation_gain *
                Math.sin((pointIndex / (routeData.length - 1)) * Math.PI)
              : 0),
        };
      });

      return {
        id: activity.id,
        name: activity.name,
        points: projectedPoints,
        color: colors[index % colors.length] ?? "#000000",
      };
    })
    .filter((activity): activity is ProjectedActivity => activity !== null);
}

/**
 * Custom hook to fetch detailed activity data for multiple activities
 * Uses React Query's useQueries to cache each activity individually
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const basicActivities = api.strava.athlete.listActivities.useQuery({ per_page: 10 });
 *   const activityIds = basicActivities.data?.map(a => a.id.toString()) ?? [];
 *   const { activities: detailedActivities, isLoading } = useDetailedActivities(activityIds);
 *
 *   return (
 *     <div>
 *       {isLoading && <div>Loading details...</div>}
 *       {detailedActivities.map(activity => (
 *         <ActivityCard key={activity.id} activity={activity} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useDetailedActivities(activityIds: string[]) {
  // Use TRPC's built-in utilities for multiple queries
  const queries = useStable(
    api.useQueries(
      useCallback(
        (t) => activityIds.map((id) => t.strava.athlete.getActivity({ id })),
        [activityIds],
      ),
    ),
  );

  // Extract data and loading states
  const activities = useMemo(
    () =>
      queries
        .map((q) => q.data)
        .filter((data): data is DetailedActivityResponse => data !== undefined),
    [queries],
  );
  const isLoading = queries.some((q) => q.isLoading);
  const errors = useMemo(
    () =>
      queries
        .map((q) => q.error)
        .filter((error) => error !== null && error !== undefined),
    [queries],
  );

  return {
    activities,
    isLoading,
    errors,
    queries, // Expose individual query states if needed
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMPTY_ARRAY = [] satisfies any[];
/**
 * Unified hook that combines basic activity list with detailed activity data
 * Returns a unified list where activities are detailed when available, basic when not
 */
export function useActivities(options?: {
  per_page?: number;
  page?: number;
  before?: number;
  after?: number;
}) {
  // Get basic activity list
  const {
    data: basicActivities,
    isLoading: isLoadingBasic,
    error: basicError,
  } = api.strava.athlete.listActivities.useQuery(options ?? {});

  // Extract activity IDs and fetch detailed data
  const activityIds = useMemo(
    () => getActivityIds(basicActivities ?? EMPTY_ARRAY),
    [basicActivities],
  );
  const {
    activities: detailedActivities,
    isLoading: isLoadingDetails,
    errors: detailErrors,
  } = useDetailedActivities(activityIds);

  // Create a map of detailed activities by ID for quick lookup
  const detailedActivitiesMap = useMemo(
    () =>
      new Map(
        detailedActivities.map((activity) => [
          activity.id.toString(),
          activity,
        ]),
      ),
    [detailedActivities],
  );

  // Merge basic and detailed data
  const unifiedActivities = useMemo(
    () =>
      basicActivities?.map((basicActivity) => {
        const detailedActivity = detailedActivitiesMap.get(
          basicActivity.id.toString(),
        );
        // Return detailed activity if available, otherwise return basic activity
        return detailedActivity ?? basicActivity;
      }) ?? [],
    [basicActivities, detailedActivitiesMap],
  );

  return {
    activities: unifiedActivities,
    isLoading: isLoadingBasic || isLoadingDetails,
    error: basicError,
    detailErrors,
    // Expose individual states if needed
    basicActivities,
    detailedActivities,
    isLoadingBasic,
    isLoadingDetails,
  };
}

/**
 * Helper function to extract activity IDs from basic activity data
 */
export function getActivityIds(
  activities: DetailedActivityResponse[],
): string[] {
  return activities.map((activity) => activity.id.toString());
}
