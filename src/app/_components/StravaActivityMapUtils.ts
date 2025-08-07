import polyline from "@mapbox/polyline";
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
  try {
    // Use the reliable Mapbox polyline decoder
    const decoded = polyline.decode(encoded);

    // Convert from [lat, lng] arrays to {lat, lng} objects
    const points = decoded.map(([lat, lng]) => ({ lat, lng }));

    console.log("Decoded polyline:", encoded.substring(0, 50) + "...");
    console.log("First few points:", points.slice(0, 3));
    console.log("Total points:", points.length);

    // Validate that we have reasonable coordinates (should be around 37, -122 for SF area)
    if (points.length > 0) {
      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      console.log("Coordinate validation:");
      console.log("  First point:", firstPoint);
      console.log("  Last point:", lastPoint);
      console.log(
        "  Lat range:",
        Math.min(...points.map((p) => p.lat)),
        "to",
        Math.max(...points.map((p) => p.lat)),
      );
      console.log(
        "  Lng range:",
        Math.min(...points.map((p) => p.lng)),
        "to",
        Math.max(...points.map((p) => p.lng)),
      );
    }

    return points;
  } catch (error) {
    console.error("Error decoding polyline:", error);
    return [];
  }
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

  // Calculate center
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  // Create a GeoJSON feature collection from the bounding box
  const bboxFeature = {
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat], // Close the polygon
        ],
      ],
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
  const bounds = path.bounds(bboxFeature);

  console.log("Initial bounds:", bounds);

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

  console.log("Calculated scale:", scale, "offset:", offset);

  // Create the final projection with optimal parameters
  projection = d3
    .geoAlbers()
    .center([centerLng, centerLat])
    .parallels([minLat, maxLat])
    .scale(scale)
    .translate(offset);

  // Test with a known coordinate
  const testPoint = projection([centerLng, centerLat]);
  console.log("Test projection of center:", testPoint);

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

  return activities
    .filter(
      (
        activity,
      ): activity is DetailedActivityResponse & {
        map: { summary_polyline: string };
      } => Boolean(activity.map?.summary_polyline),
    )
    .map((activity, index) => {
      const points = decodePolyline(activity.map.summary_polyline);
      console.log(`Activity ${activity.id}: ${points.length} points`);

      if (points.length === 0) {
        console.warn(`No points decoded for activity ${activity.id}`);
        return null;
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
    })
    .filter((activity): activity is ProjectedActivity => activity !== null);
}
