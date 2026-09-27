import * as d3 from "d3";
import { describe, expect, it } from "vitest";

import {
  SAMPLE_POLYLINE,
  SAMPLE_POLYLINE_POINTS,
  makeActivity,
} from "~/test/fixtures";
import {
  createProjection,
  decodePolyline,
  getActivityIds,
  getActivityRouteData,
  mergeStreamsData,
  projectActivities,
} from "./ActivityMapUtils";

describe("decodePolyline (@mapbox/polyline)", () => {
  it("decodes Google's canonical polyline to lat/lng pairs", () => {
    const points = decodePolyline(SAMPLE_POLYLINE);

    expect(points).toHaveLength(3);
    points.forEach((point, index) => {
      const expected = SAMPLE_POLYLINE_POINTS[index]!;
      expect(point.lat).toBeCloseTo(expected.lat, 5);
      expect(point.lng).toBeCloseTo(expected.lng, 5);
    });
  });

  it("leaves altitude undefined when no altitude data is supplied", () => {
    const points = decodePolyline(SAMPLE_POLYLINE);

    expect(points.map((point) => point.altitude)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("zips altitude data onto the decoded points by index", () => {
    const points = decodePolyline(SAMPLE_POLYLINE, [10, 20]);

    expect(points.map((point) => point.altitude)).toEqual([10, 20, undefined]);
  });

  it("returns an empty array for an empty polyline", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});

describe("getActivityRouteData", () => {
  it("prefers stream-derived detailedPoints over the polyline", () => {
    const activity = makeActivity({
      polyline: SAMPLE_POLYLINE,
      detailedPoints: [
        {
          lat: 1,
          lng: 2,
          altitude: 3,
          lnglat_resolution: "high",
          altitude_resolution: "high",
        },
      ],
    });

    expect(getActivityRouteData(activity)).toEqual([
      { lat: 1, lng: 2, altitude: 3 },
    ]);
  });

  it("falls back to the full polyline, then the summary polyline", () => {
    const full = makeActivity({ polyline: SAMPLE_POLYLINE });
    const summaryOnly = makeActivity({ summary_polyline: SAMPLE_POLYLINE });

    expect(getActivityRouteData(full)).toHaveLength(3);
    expect(getActivityRouteData(summaryOnly)).toHaveLength(3);
  });

  it("returns an empty array when the activity has no route at all", () => {
    expect(getActivityRouteData(makeActivity())).toEqual([]);
  });
});

describe("createProjection (d3-geo)", () => {
  it("fits the route inside the requested dimensions", () => {
    const width = 800;
    const height = 600;
    const projection = createProjection(
      [makeActivity({ polyline: SAMPLE_POLYLINE })],
      width,
      height,
    );

    const projected = SAMPLE_POLYLINE_POINTS.map(
      (point) => projection([point.lng, point.lat])!,
    );

    projected.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(width);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(height);
    });
  });

  it("uses at least 95% of one axis so the route is not tiny", () => {
    const width = 800;
    const height = 600;
    const projection = createProjection(
      [makeActivity({ polyline: SAMPLE_POLYLINE })],
      width,
      height,
    );

    const projected = SAMPLE_POLYLINE_POINTS.map(
      (point) => projection([point.lng, point.lat])!,
    );
    const spanX =
      d3.max(projected, (p) => p[0])! - d3.min(projected, (p) => p[0])!;
    const spanY =
      d3.max(projected, (p) => p[1])! - d3.min(projected, (p) => p[1])!;

    expect(Math.max(spanX / width, spanY / height)).toBeGreaterThan(0.9);
  });

  it("falls back to a centred mercator when there are no points", () => {
    const projection = createProjection([makeActivity()], 800, 600);

    expect(projection([0, 0])).toEqual([400, 300]);
  });
});

describe("projectActivities", () => {
  it("skips activities that have no polyline", () => {
    const projection = d3.geoMercator();
    const result = projectActivities(
      [
        makeActivity({ id: 1 }),
        makeActivity({ id: 2, polyline: SAMPLE_POLYLINE }),
      ],
      projection,
    );

    expect(result.map((activity) => activity.id)).toEqual([2]);
  });

  it("assigns colours from d3.schemeCategory10 and wraps around", () => {
    const projection = d3.geoMercator();
    const activities = Array.from({ length: 11 }, (_, index) =>
      makeActivity({ id: index + 1, polyline: SAMPLE_POLYLINE }),
    );

    const result = projectActivities(activities, projection);

    expect(result[0]!.color).toBe(d3.schemeCategory10[0]);
    expect(result[10]!.color).toBe(d3.schemeCategory10[0]);
  });

  it("normalises altitude into a 0-100 z range across all activities", () => {
    const projection = d3.geoMercator();
    const activity = makeActivity({
      polyline: SAMPLE_POLYLINE,
      detailedPoints: [
        {
          lat: 1,
          lng: 1,
          altitude: 100,
          lnglat_resolution: "high",
          altitude_resolution: "high",
        },
        {
          lat: 2,
          lng: 2,
          altitude: 150,
          lnglat_resolution: "high",
          altitude_resolution: "high",
        },
        {
          lat: 3,
          lng: 3,
          altitude: 200,
          lnglat_resolution: "high",
          altitude_resolution: "high",
        },
      ],
    });

    const [projected] = projectActivities([activity], projection);

    expect(projected!.points.map((point) => point.z)).toEqual([0, 50, 100]);
  });

  it("leaves z at 0 when no altitude data exists", () => {
    const projection = d3.geoMercator();
    const [projected] = projectActivities(
      [makeActivity({ polyline: SAMPLE_POLYLINE })],
      projection,
    );

    expect(projected!.points.every((point) => point.z === 0)).toBe(true);
  });
});

describe("mergeStreamsData", () => {
  it("merges the latlng and altitude streams index by index", () => {
    const merged = mergeStreamsData(
      [
        [38.5, -120.2],
        [40.7, -120.95],
      ],
      [100, 200],
      "high",
      "low",
    );

    expect(merged).toEqual([
      {
        lat: 38.5,
        lng: -120.2,
        altitude: 100,
        lnglat_resolution: "high",
        altitude_resolution: "low",
      },
      {
        lat: 40.7,
        lng: -120.95,
        altitude: 200,
        lnglat_resolution: "high",
        altitude_resolution: "low",
      },
    ]);
  });

  it("defaults missing resolutions to 'unknown' and tolerates a short altitude stream", () => {
    const merged = mergeStreamsData([[1, 2]], []);

    expect(merged).toEqual([
      {
        lat: 1,
        lng: 2,
        altitude: undefined,
        lnglat_resolution: "unknown",
        altitude_resolution: "unknown",
      },
    ]);
  });

  it("returns an empty array when there is no latlng stream", () => {
    expect(mergeStreamsData(undefined, [1, 2])).toEqual([]);
    expect(mergeStreamsData([], [1, 2])).toEqual([]);
  });
});

describe("getActivityIds", () => {
  it("stringifies numeric Strava activity ids", () => {
    expect(
      getActivityIds([
        makeActivity({ id: 12345678901 }),
        makeActivity({ id: 2 }),
      ]),
    ).toEqual(["12345678901", "2"]);
  });
});
