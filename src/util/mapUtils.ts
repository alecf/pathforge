import type * as d3 from "d3";
import { type DetailedActivityResponse } from "strava-v3";
import {
  type ActivityWithStreams,
  type ProjectedActivity,
  createProjection,
  decodePolyline as decodePolylineHelper,
  projectActivities,
} from "~/app/_components/ActivityMapUtils";

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
export const decodePolyline = decodePolylineHelper;

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

/**
 * Rough miles per degree at a given latitude
 * - Latitude: ~69 miles/deg
 * - Longitude: ~69 * cos(latitude) miles/deg
 */
export function getMilesPerDegree(latitudeDeg: number): {
  milesPerDegreeLat: number;
  milesPerDegreeLng: number;
} {
  const latRad = (latitudeDeg * Math.PI) / 180;
  const milesPerDegreeLat = 69;
  const milesPerDegreeLng = Math.max(1e-6, 69 * Math.cos(latRad));
  return { milesPerDegreeLat, milesPerDegreeLng };
}

/**
 * Estimate the number of projected units that correspond to one mile around a center point.
 * Returns null if projection fails.
 */
export function estimateProjectedUnitsPerMile(
  projection: d3.GeoProjection,
  centerLng: number,
  centerLat: number,
): number | null {
  const base = projection([centerLng, centerLat]);
  if (!base) return null;

  const { milesPerDegreeLat, milesPerDegreeLng } = getMilesPerDegree(centerLat);
  const oneMileLatDeg = 1 / milesPerDegreeLat;
  const oneMileLngDeg = 1 / milesPerDegreeLng;

  const lngShift = projection([centerLng + oneMileLngDeg, centerLat]);
  const latShift = projection([centerLng, centerLat + oneMileLatDeg]);
  if (!lngShift || !latShift) return null;

  const mileInProjUnitsX = Math.abs(lngShift[0] - base[0]);
  const mileInProjUnitsY = Math.abs(latShift[1] - base[1]);
  const avg = (mileInProjUnitsX + mileInProjUnitsY) / 2;
  if (!Number.isFinite(avg) || avg <= 0) return null;
  return avg;
}

/**
 * Compute grid spacings (minor and major) based on projection and center point.
 * Minor is quarter-mile, major is one-mile. Applies clamping relative to bounds.
 */
export function deriveGridSpacings(
  projection: d3.GeoProjection,
  centerLng: number,
  centerLat: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): { cellSize: number; sectionSize: number } {
  // defaults
  let cellSize = 50;
  let sectionSize = 200;

  const unitsPerMile = estimateProjectedUnitsPerMile(
    projection,
    centerLng,
    centerLat,
  );

  if (unitsPerMile) {
    cellSize = Math.max(1, unitsPerMile * 0.25);
    sectionSize = Math.max(1, unitsPerMile);

    const maxExtent = Math.max(
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    );
    const maxMajor = Math.max(10, maxExtent / 2);
    if (sectionSize > maxMajor) {
      const scale = maxMajor / sectionSize;
      sectionSize *= scale;
      cellSize *= scale;
    }
  }

  return { cellSize, sectionSize };
}
