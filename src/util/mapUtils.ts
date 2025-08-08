import * as d3 from "d3";
import { type DetailedActivityResponse } from "strava-v3";
import {
  type ActivityWithStreams,
  type ProjectedActivity,
  createProjection,
  projectActivities,
} from "~/app/_components/StravaActivityMapUtils";

export interface MapViewProps {
  activities: (DetailedActivityResponse | ActivityWithStreams)[];
  width: number;
  height: number;
}

export interface MapViewState {
  projectedActivities: ProjectedActivity[];
  projection: d3.GeoProjection;
  dimensions: { width: number; height: number };
}

/**
 * Shared logic for processing activities and creating projections
 * Used by both 2D and 3D map components
 */
export function useMapProjection(props: MapViewProps): MapViewState {
  const { activities, width, height } = props;

  // Create projection
  const projection = createProjection(activities, width, height);

  // Project activities
  const projectedActivities = projectActivities(activities, projection);

  return {
    projectedActivities,
    projection,
    dimensions: { width, height },
  };
}

/**
 * Calculate altitude bounds across all activities for normalization
 */
export function calculateAltitudeBounds(
  activities: (DetailedActivityResponse | ActivityWithStreams)[],
): { minAltitude: number; maxAltitude: number; hasAltitudeData: boolean } {
  let minAltitude = Infinity;
  let maxAltitude = -Infinity;
  let hasAltitudeData = false;

  activities.forEach((activity) => {
    const routeData = getActivityRouteData(activity);
    routeData.forEach((point) => {
      if (point.altitude !== undefined) {
        minAltitude = Math.min(minAltitude, point.altitude);
        maxAltitude = Math.max(maxAltitude, point.altitude);
        hasAltitudeData = true;
      }
    });
  });

  if (!hasAltitudeData) {
    minAltitude = 0;
    maxAltitude = 0;
  }

  return { minAltitude, maxAltitude, hasAltitudeData };
}

/**
 * Get route data for an activity (shared between 2D and 3D)
 */
export function getActivityRouteData(
  activity: DetailedActivityResponse | ActivityWithStreams,
) {
  // First try to use streams data if available (most accurate)
  if ("detailedPoints" in activity && activity.detailedPoints) {
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
 * Decode Google's polyline format to array of lat/lng/altitude points
 */
export function decodePolyline(
  encoded: string,
  altitudeData?: number[],
): Array<{ lat: number; lng: number; altitude?: number }> {
  try {
    // Use the reliable Mapbox polyline decoder
    const polyline = require("@mapbox/polyline");
    const decoded = polyline.decode(encoded);

    // Convert from [lat, lng] arrays to {lat, lng, altitude} objects
    const points = decoded.map(
      ([lat, lng]: [number, number], index: number) => ({
        lat,
        lng,
        altitude: altitudeData?.[index],
      }),
    );

    return points;
  } catch (error) {
    console.error("Error decoding polyline:", error);
    return [];
  }
}

/**
 * Convert miles to meters for grid calculations
 */
export function milesToMeters(miles: number): number {
  return miles * 1609.344;
}

/**
 * Convert meters to miles
 */
export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}
