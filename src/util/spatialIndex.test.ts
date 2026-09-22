import { describe, expect, it } from "vitest";

import {
  buildPointsIndex,
  buildSegmentGridIndex,
  isPointNearAnySegment,
  queryPointsWithinRadius,
  querySegmentsNear,
  type ProjectedActivitySimple,
} from "./spatialIndex";

const LINE: ProjectedActivitySimple = {
  id: "line",
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
};

const SECOND_LINE: ProjectedActivitySimple = {
  id: 42,
  points: [
    { x: 100, y: 100 },
    { x: 110, y: 100 },
  ],
};

describe("buildPointsIndex (KDBush)", () => {
  it("returns undefined for no activities and for point-less activities", () => {
    expect(buildPointsIndex([])).toBeUndefined();
    expect(buildPointsIndex([{ id: "empty", points: [] }])).toBeUndefined();
  });

  it("flattens every point and tags it with its activity and position", () => {
    const index = buildPointsIndex([LINE, SECOND_LINE])!;

    expect(index.points).toHaveLength(5);
    expect(index.points[0]).toEqual({
      x: 0,
      y: 0,
      activityId: "line",
      pointIndex: 0,
    });
    expect(index.points[4]).toEqual({
      x: 110,
      y: 100,
      activityId: 42,
      pointIndex: 1,
    });
  });

  it("records the bounding box across all activities", () => {
    const index = buildPointsIndex([LINE, SECOND_LINE])!;

    expect(index.bounds).toEqual({ minX: 0, maxX: 110, minY: 0, maxY: 100 });
  });
});

describe("queryPointsWithinRadius", () => {
  it("returns points inside the radius", () => {
    const index = buildPointsIndex([LINE])!;

    const hits = queryPointsWithinRadius(index, 0, 0, 1);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.pointIndex).toBe(0);
  });

  it("applies a circular, not a square, cutoff", () => {
    const index = buildPointsIndex([
      { id: "corner", points: [{ x: 10, y: 10 }] },
    ])!;

    // (10, 10) is inside the query bounding box but ~14.1 away from the origin.
    expect(queryPointsWithinRadius(index, 0, 0, 11)).toEqual([]);
    expect(queryPointsWithinRadius(index, 0, 0, 15)).toHaveLength(1);
  });

  it("returns nothing for a missing index or a non-positive radius", () => {
    const index = buildPointsIndex([LINE])!;

    expect(queryPointsWithinRadius(undefined, 0, 0, 5)).toEqual([]);
    expect(queryPointsWithinRadius(index, 0, 0, 0)).toEqual([]);
    expect(queryPointsWithinRadius(index, 0, 0, -1)).toEqual([]);
    expect(queryPointsWithinRadius(index, 0, 0, Number.NaN)).toEqual([]);
  });
});

describe("buildSegmentGridIndex (RBush)", () => {
  it("returns undefined when no segment can be formed", () => {
    expect(buildSegmentGridIndex([])).toBeUndefined();
    expect(
      buildSegmentGridIndex([{ id: "single", points: [{ x: 0, y: 0 }] }]),
    ).toBeUndefined();
  });

  it("creates one segment per consecutive pair with its bbox and length", () => {
    const index = buildSegmentGridIndex([LINE])!;
    const segments = index.tree.all();

    expect(segments).toHaveLength(2);
    const first = segments.find((segment) => segment.pointStartIndex === 0)!;
    expect(first).toMatchObject({
      x0: 0,
      y0: 0,
      x1: 10,
      y1: 0,
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 0,
      length: 10,
      activityId: "line",
      pointEndIndex: 1,
    });
  });

  it("records the bounding box across all segments", () => {
    const index = buildSegmentGridIndex([LINE, SECOND_LINE])!;

    expect(index.bounds).toEqual({ minX: 0, maxX: 110, minY: 0, maxY: 100 });
  });
});

describe("querySegmentsNear", () => {
  it("returns only the segments whose bbox overlaps the query box", () => {
    const index = buildSegmentGridIndex([LINE, SECOND_LINE])!;

    const near = querySegmentsNear(index, 5, 0, 1);

    expect(near).toHaveLength(1);
    expect(near[0]!.activityId).toBe("line");
  });

  it("returns nothing for a missing index or a non-positive radius", () => {
    const index = buildSegmentGridIndex([LINE])!;

    expect(querySegmentsNear(undefined, 0, 0, 5)).toEqual([]);
    expect(querySegmentsNear(index, 0, 0, 0)).toEqual([]);
  });
});

describe("isPointNearAnySegment", () => {
  it("measures distance to the segment body, not just its endpoints", () => {
    const index = buildSegmentGridIndex([LINE])!;

    // (5, 1) is 1 unit from the middle of the first segment but 5+ units from
    // either endpoint, so an endpoint-only check would miss it.
    expect(isPointNearAnySegment(index, 5, 1, 2)).toBe(true);
  });

  it("clamps the projection to the segment so points past the end miss", () => {
    const index = buildSegmentGridIndex([LINE])!;

    expect(isPointNearAnySegment(index, -5, 0, 2)).toBe(false);
    expect(isPointNearAnySegment(index, -1, 0, 2)).toBe(true);
  });

  it("handles a degenerate zero-length segment", () => {
    const index = buildSegmentGridIndex([
      {
        id: "dot",
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    ])!;

    expect(isPointNearAnySegment(index, 0, 0, 1)).toBe(true);
    expect(isPointNearAnySegment(index, 5, 5, 1)).toBe(false);
  });

  it("returns false for a missing index or a non-positive radius", () => {
    const index = buildSegmentGridIndex([LINE])!;

    expect(isPointNearAnySegment(undefined, 0, 0, 5)).toBe(false);
    expect(isPointNearAnySegment(index, 0, 0, 0)).toBe(false);
  });
});
