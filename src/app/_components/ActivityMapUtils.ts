import polyline from "@mapbox/polyline";
import * as d3 from "d3";
import { useMemo } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import type {
  StravaActivityStream,
  StravaStreamsByType,
} from "~/server/api/routers/strava";
import { api } from "~/trpc/react";
import { useStable } from "~/util/useStable";

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  minAltitude?: number;
  maxAltitude?: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  z: number;
  lat: number;
  lng: number;
  altitude?: number;
}

export interface ProjectedActivity {
  id: string;
  name: string;
  points: ProjectedPoint[];
  color: string;
}

// More specific interfaces for typed streams
export interface LatLngStream extends StravaActivityStream {
  type: "latlng";
  data: Array<[number, number]>; // [lat, lng] pairs
}

export interface AltitudeStream extends StravaActivityStream {
  type: "altitude";
  data: number[]; // altitude values
}

// New interface for activities with streams data
export interface ActivityWithStreams extends DetailedActivityResponse {
  detailedPoints?: Array<{
    lng: number;
    lat: number;
    altitude?: number;
    lnglat_resolution: string;
    altitude_resolution: string;
  }>;
}

// Always use keyed-by-type response
function isStreamMap(value: unknown): value is StravaStreamsByType {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isLatLngStream(
  stream: StravaActivityStream | undefined,
): stream is LatLngStream {
  if (!stream || stream.type !== "latlng") return false;
  const data = stream.data;
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return true;
  const first = data[0];
  return Array.isArray(first) && first.length >= 2;
}

function isAltitudeStream(
  stream: StravaActivityStream | undefined,
): stream is AltitudeStream {
  if (!stream || stream.type !== "altitude") return false;
  const data = stream.data;
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return true;
  return typeof data[0] === "number";
}

/**
 * Decode Google's polyline format to array of lat/lng/altitude points
 * @param encoded Encoded polyline string from Strava
 * @param altitudeData Optional altitude data array from detailed activity
 * @returns Array of lat/lng/altitude coordinates
 */
export function decodePolyline(
  encoded: string,
  altitudeData?: number[],
): Array<{ lat: number; lng: number; altitude?: number }> {
  try {
    // Use the reliable Mapbox polyline decoder
    const decoded = polyline.decode(encoded);

    // Convert from [lat, lng] arrays to {lat, lng, altitude} objects
    const points = decoded.map(([lat, lng], index) => ({
      lat,
      lng,
      altitude: altitudeData?.[index],
    }));

    return points;
  } catch (error) {
    console.error("Error decoding polyline:", error);
    return [];
  }
}

/**
 * Get the best available route data for an activity
 * Prioritizes streams data over polylines for more accurate coordinates and altitude
 */
export function getActivityRouteData(
  activity: DetailedActivityResponse | ActivityWithStreams,
) {
  // First try to use streams data if available (most accurate)
  if (
    "detailedPoints" in activity &&
    Array.isArray(activity.detailedPoints) &&
    activity.detailedPoints.length > 0
  ) {
    return activity.detailedPoints.map((point) => ({
      lat: point.lat,
      lng: point.lng,
      altitude: point.altitude,
    }));
  }

  // Fall back to polyline data if streams not available
  const polylineData = activity.map?.polyline ?? activity.map?.summary_polyline;

  if (polylineData) {
    const points = decodePolyline(polylineData);
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
  activities: (DetailedActivityResponse | ActivityWithStreams)[],
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
  activities: (DetailedActivityResponse | ActivityWithStreams)[],
  projection: d3.GeoProjection,
): ProjectedActivity[] {
  const colors = d3.schemeCategory10;

  // Calculate altitude bounds across all activities
  let minAltitude = Infinity;
  let maxAltitude = -Infinity;
  let hasAltitudeData = false;

  // First pass: collect altitude data to determine bounds
  activities.forEach((activity) => {
    const routeData = getActivityRouteData(activity);

    // Only use actual altitude data from detailed activity points
    routeData.forEach((point) => {
      if (point.altitude !== undefined) {
        minAltitude = Math.min(minAltitude, point.altitude);
        maxAltitude = Math.max(maxAltitude, point.altitude);
        hasAltitudeData = true;
      }
    });
  });

  // If no altitude data, default both to 0
  if (!hasAltitudeData) {
    minAltitude = 0;
    maxAltitude = 0;
  }

  return activities
    .map((activity, index): ProjectedActivity | null => {
      const routeData = getActivityRouteData(activity);

      if (routeData.length === 0) {
        return null;
      }

      const projectedPoints: ProjectedPoint[] = routeData.map(
        (point): ProjectedPoint => {
          const projected = projection([point.lng, point.lat]);
          const [x, y] = projected ?? [0, 0];

          // Project altitude to z coordinate
          let z = 0;
          if (hasAltitudeData && point.altitude !== undefined) {
            // Use actual altitude data from detailed activity
            const altitudeRange = Math.max(1e-6, maxAltitude - minAltitude);
            z = ((point.altitude - minAltitude) / altitudeRange) * 100;
          }

          return {
            x,
            y,
            z,
            lat: point.lat,
            lng: point.lng,
            altitude: point.altitude,
          };
        },
      );

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
 * Merge latlng and altitude streams into a flat array of detailed points
 * @param latlngStream Array of [lat, lng] coordinates from Strava streams API
 * @param altitudeStream Array of altitude values from Strava streams API
 * @param lnglatResolution Resolution of the latlng stream
 * @param altitudeResolution Resolution of the altitude stream
 * @returns Array of detailed points with lng, lat, altitude, and resolution data
 */
export function mergeStreamsData(
  latlngStream?: Array<[number, number]>,
  altitudeStream?: number[],
  lnglatResolution?: string,
  altitudeResolution?: string,
): Array<{
  lng: number;
  lat: number;
  altitude?: number;
  lnglat_resolution: string;
  altitude_resolution: string;
}> {
  if (!latlngStream || latlngStream.length === 0) {
    return [];
  }

  return latlngStream.map(([lat, lng], index) => ({
    lng,
    lat,
    altitude: altitudeStream?.[index],
    lnglat_resolution: lnglatResolution ?? "unknown",
    altitude_resolution: altitudeResolution ?? "unknown",
  }));
}

/**
 * Custom hook to fetch detailed activity data with streams for multiple activities
 * Uses React Query's useQueries to cache each activity individually
 */
export function useDetailedActivitiesWithStreams(activityIds: string[]) {
  // Use TRPC's built-in utilities for multiple queries
  const activityQueries = useStable(
    api.useQueries((t) =>
      activityIds.map((id) => t.strava.athlete.getActivity({ id })),
    ),
  );

  const streamsQueries = useStable(
    api.useQueries((t) =>
      activityIds.map((id) =>
        t.strava.athlete.getActivityStreams({
          id,
          keys: ["latlng", "altitude"],
          key_by_type: true,
        }),
      ),
    ),
  );

  // Merge activities with their streams data by index (aligned with activityIds)
  const activitiesWithStreams = useMemo(() => {
    const merged: ActivityWithStreams[] = [];

    activityQueries.forEach((activityQuery, index) => {
      const activity = activityQuery.data;
      if (!activity) return;

      const streams = streamsQueries[index]?.data;

      // Support keyed-by-type responses
      let latlngData: Array<[number, number]> | undefined;
      let altitudeData: number[] | undefined;
      let latlngRes: string | undefined;
      let altitudeRes: string | undefined;

      if (isStreamMap(streams)) {
        const latlng = streams.latlng;
        const altitude = streams.altitude;
        if (isLatLngStream(latlng)) {
          latlngData = latlng.data;
          latlngRes = latlng.resolution;
        }
        if (isAltitudeStream(altitude)) {
          altitudeData = altitude.data;
          altitudeRes = altitude.resolution;
        }
      }

      const detailedPoints = mergeStreamsData(
        latlngData,
        altitudeData,
        latlngRes,
        altitudeRes,
      );

      if (detailedPoints.length > 0) {
        merged.push({ ...activity, detailedPoints });
      } else {
        // If there are no stream points, omit detailedPoints so callers can
        // fall back to polyline data for rendering
        merged.push(activity);
      }
    });

    return merged;
  }, [activityQueries, streamsQueries]);

  const isLoading =
    activityQueries.some((q) => q.isLoading) ||
    streamsQueries.some((q) => q.isLoading);
  const errors = useMemo(
    () =>
      [...activityQueries, ...streamsQueries]
        .map((q) => q.error)
        .filter((error) => error !== null && error !== undefined),
    [activityQueries, streamsQueries],
  );

  return {
    activities: activitiesWithStreams,
    isLoading,
    errors,
    activityQueries,
    streamsQueries,
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

  // Extract activity IDs and fetch detailed data with streams
  const activityIds = useMemo(
    () => getActivityIds(basicActivities ?? EMPTY_ARRAY),
    [basicActivities],
  );
  const {
    activities: detailedActivities,
    isLoading: isLoadingDetails,
    errors: detailErrors,
  } = useDetailedActivitiesWithStreams(activityIds);

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
