import type { ActivityWithStreams } from "~/app/_components/ActivityMapUtils";
import type { ProjectedActivity } from "~/app/_components/ActivityMapUtils";

/**
 * The canonical example from Google's polyline algorithm documentation.
 * Decodes to (38.5, -120.2), (40.7, -120.95), (43.252, -126.453).
 */
export const SAMPLE_POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

export const SAMPLE_POLYLINE_POINTS = [
  { lat: 38.5, lng: -120.2 },
  { lat: 40.7, lng: -120.95 },
  { lat: 43.252, lng: -126.453 },
];

interface ActivityOverrides {
  id?: number;
  name?: string;
  polyline?: string;
  summary_polyline?: string;
  detailedPoints?: ActivityWithStreams["detailedPoints"];
}

/**
 * Strava's `DetailedActivity` carries ~60 fields, but the map/projection helpers
 * only ever read `id`, `name`, `map` and `detailedPoints`. Building the full
 * shape in every test would bury the thing under assertion, so the fixture
 * narrows once, here.
 */
export function makeActivity(
  overrides: ActivityOverrides = {},
): ActivityWithStreams {
  const {
    id = 1,
    name = "Morning Ride",
    polyline,
    summary_polyline,
    detailedPoints,
  } = overrides;

  const activity = {
    id,
    name,
    map: {
      id: `a${id}`,
      polyline,
      summary_polyline,
      resource_state: 3,
    },
    ...(detailedPoints === undefined ? {} : { detailedPoints }),
  };

  return activity as unknown as ActivityWithStreams;
}

interface ProjectedOverrides {
  id?: string | number;
  name?: string;
  color?: string;
}

/**
 * Build a `ProjectedActivity` from bare x/y/altitude triples for the
 * densification helpers, which only read `points`.
 */
export function makeProjectedActivity(
  points: Array<{ x: number; y: number; altitude?: number }>,
  overrides: ProjectedOverrides = {},
): ProjectedActivity {
  const { id = "p1", name = "Projected", color = "#1f77b4" } = overrides;

  return {
    id,
    name,
    color,
    points: points.map((point) => ({
      x: point.x,
      y: point.y,
      z: 0,
      lat: 0,
      lng: 0,
      altitude: point.altitude,
    })),
  };
}

/**
 * A small grid of samples with a linear altitude ramp, enough for Delaunay
 * triangulation (which needs at least three non-collinear points).
 */
export function makeAltitudeGrid(size = 5, spacing = 10): ProjectedActivity {
  const points = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => ({
      x: col * spacing,
      y: row * spacing,
      altitude: 100 + col * 10 + row * 5,
    })),
  ).flat();

  return makeProjectedActivity(points, { id: "grid", name: "Grid" });
}
