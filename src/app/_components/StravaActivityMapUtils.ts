import * as d3 from "d3";
import { type DetailedActivityResponse } from "strava-v3";

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface ProjectedActivity {
  id: string;
  name: string;
  points: ProjectedPoint[];
  color: string;
}

/**
 * Calculate bounding box for all activities
 * @param activities Array of Strava activities
 * @returns BoundingBox with min/max lat/lng values
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

  console.log("Calculating bounding box for", activities.length, "activities");

  activities.forEach((activity) => {
    if (activity.map?.summary_polyline) {
      const points = decodePolyline(activity.map.summary_polyline);
      console.log(`Activity ${activity.id}: ${points.length} points`);
      if (points.length > 0) {
        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        console.log(`Activity ${activity.id} lat range:`, [
          firstPoint?.lat,
          lastPoint?.lat,
        ]);
        console.log(`Activity ${activity.id} lng range:`, [
          firstPoint?.lng,
          lastPoint?.lng,
        ]);
      }
      points.forEach((point) => {
        minLat = Math.min(minLat, point.lat);
        maxLat = Math.max(maxLat, point.lat);
        minLng = Math.min(minLng, point.lng);
        maxLng = Math.max(maxLng, point.lng);
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
    console.warn("No valid coordinates found, using fallback bounding box");
    return { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };
  }

  // Add padding to the bounding box
  const latPadding = (maxLat - minLat) * 0.1;
  const lngPadding = (maxLng - minLng) * 0.1;

  const result = {
    minLat: minLat - latPadding,
    maxLat: maxLat + latPadding,
    minLng: minLng - lngPadding,
    maxLng: maxLng + lngPadding,
  };

  console.log("Bounding box result:", result);
  return result;
}

/**
 * Decode Google's polyline format to array of lat/lng points
 * @param encoded Encoded polyline string from Strava
 * @returns Array of lat/lng coordinates
 */
export function decodePolyline(
  encoded: string,
): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  console.log("Decoding polyline:", encoded.substring(0, 50) + "...");

  // Test with a known polyline first
  if (encoded === "test") {
    console.log("Testing with known polyline");
    return [
      { lat: 37.7749, lng: -122.4194 }, // San Francisco
      { lat: 37.7849, lng: -122.4094 }, // Slightly north
    ];
  }

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;

    do {
      const b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (result >= 0x20);

    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      const b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (result >= 0x20);

    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    const point = { lat: lat / 1e5, lng: lng / 1e5 };
    points.push(point);
  }

  console.log("Decoded points:", points.slice(0, 5), "...");
  return points;
}

/**
 * Create a D3 projection that fits the bounding box to the given dimensions
 * @param boundingBox The bounding box of all activities
 * @param width Width of the container
 * @param height Height of the container
 * @returns D3 geo projection
 */
export function createProjection(
  boundingBox: BoundingBox,
  width: number,
  height: number,
) {
  const { minLat, maxLat, minLng, maxLng } = boundingBox;

  console.log("Creating projection for:", { width, height, boundingBox });

  // Check if bounding box is valid
  if (minLat === maxLat || minLng === maxLng) {
    console.warn("Invalid bounding box, using fallback projection");
    return d3
      .geoMercator()
      .center([0, 0])
      .scale(100)
      .translate([width / 2, height / 2]);
  }

  // Calculate center and scale
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;

  // Use a more aggressive scale calculation
  const scale = Math.min(width / lngSpan, height / latSpan) * 0.6; // Reduced padding for larger scale

  // If the scale is too small, use a minimum scale
  const minScale = Math.min(width, height) * 0.1; // At least 10% of the smaller dimension
  const finalScale = Math.max(scale, minScale);

  // If the coordinate spans are very small, use a much larger scale
  const verySmallSpan = latSpan < 0.01 || lngSpan < 0.01;
  const adjustedScale = verySmallSpan ? finalScale * 100 : finalScale;

  console.log(
    "Center:",
    [centerLng, centerLat],
    "Scale:",
    adjustedScale,
    "Original scale:",
    scale,
    "Very small span:",
    verySmallSpan,
  );
  console.log("Coordinate spans - Lat:", latSpan, "Lng:", lngSpan);
  console.log("Canvas dimensions - Width:", width, "Height:", height);

  // Use standard Mercator projection with adjusted scale for small areas
  const projection = d3
    .geoMercator()
    .center([centerLng, centerLat])
    .scale(adjustedScale)
    .translate([width / 2, height / 2]);

  // Test with a known coordinate
  const testPoint = projection([centerLng, centerLat]);
  console.log("Test projection of center:", testPoint);

  console.log("Projection created:", projection);
  return projection;
}

/**
 * Project activities to x/y coordinates using the given projection
 * @param activities Array of Strava activities
 * @param projection D3 geo projection
 * @returns Array of projected activities with x/y coordinates
 */
export function projectActivities(
  activities: DetailedActivityResponse[],
  projection: d3.GeoProjection,
): ProjectedActivity[] {
  const colors = d3.schemeCategory10;

  // If no activities with polylines, create a test activity
  if (activities.filter((a) => a.map?.summary_polyline).length === 0) {
    console.log("No activities with polylines, creating test activity");
    const testPoints = [
      { lat: 37.7749, lng: -122.4194 }, // San Francisco
      { lat: 37.7849, lng: -122.4094 }, // Slightly north
      { lat: 37.7949, lng: -122.3994 }, // Further north
    ];

    const projectedTestPoints = testPoints.map((point) => {
      const projected = projection([point.lng, point.lat]);
      console.log(
        `Test projecting [${point.lng}, ${point.lat}] -> [${projected?.[0]}, ${projected?.[1]}]`,
      );
      const [x, y] = projected ?? [0, 0];
      return { x, y };
    });

    return [
      {
        id: "test",
        name: "Test Activity",
        points: projectedTestPoints,
        color: colors[0] ?? "#000000",
      },
    ];
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
      // For testing, let's try using start/end coordinates if polyline fails
      let points: Array<{ lat: number; lng: number }> = [];

      try {
        points = decodePolyline(activity.map.summary_polyline);
        console.log(`Activity ${activity.id} raw points:`, points.slice(0, 3));
      } catch (error) {
        console.error(
          `Error decoding polyline for activity ${activity.id}:`,
          error,
        );
        // Fallback to start/end coordinates
        if (activity.start_latlng && activity.end_latlng) {
          points = [
            {
              lat: activity.start_latlng[0] ?? 0,
              lng: activity.start_latlng[1] ?? 0,
            },
            {
              lat: activity.end_latlng[0] ?? 0,
              lng: activity.end_latlng[1] ?? 0,
            },
          ];
          console.log(
            `Using start/end coordinates for activity ${activity.id}:`,
            points,
          );
        }
      }

      const projectedPoints = points.map((point) => {
        const projected = projection([point.lng, point.lat]);
        console.log(
          `Projecting [${point.lng}, ${point.lat}] -> [${projected?.[0]}, ${projected?.[1]}]`,
        );
        const [x, y] = projected ?? [0, 0];
        return { x, y };
      });

      console.log(
        `Activity ${activity.id} projected points:`,
        projectedPoints.slice(0, 3),
      );

      return {
        id: activity.id,
        name: activity.name,
        points: projectedPoints,
        color: colors[index % colors.length] ?? "#000000",
      };
    });
}
