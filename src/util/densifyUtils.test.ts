import { describe, expect, it } from "vitest";

import { makeAltitudeGrid, makeProjectedActivity } from "~/test/fixtures";
import {
  convertProjectedToLatLng,
  densify,
  getAvailableMethods,
} from "./densifyUtils";

const GRID = makeAltitudeGrid();
const GRID_MIN_ALTITUDE = 100;
const GRID_MAX_ALTITUDE = 160;

// The grid spans 0..40 on both axes; a density of 1 keeps the sample count
// small enough for a fast test while still exercising the grid walk.
const DENSITY = 1;

describe("getAvailableMethods", () => {
  it("advertises the three densification methods", async () => {
    const methods = await getAvailableMethods();

    expect(methods.map((entry) => entry.method).sort()).toEqual([
      "delaunay",
      "interpolation",
      "mls",
    ]);
    methods.forEach((entry) => {
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
    });
  });
});

describe("densify", () => {
  it("defaults to the MLS method", async () => {
    const auto = await densify([GRID], { density: DENSITY });
    const mls = await densify([GRID], { density: DENSITY, method: "mls" });

    expect(auto).toEqual(mls);
  });

  it("reports the un-padded sample bounds for MLS", async () => {
    const { bounds } = await densify([GRID], {
      density: DENSITY,
      method: "mls",
    });

    expect(bounds).toEqual({
      minX: 0,
      maxX: 40,
      minY: 0,
      maxY: 40,
      minZ: GRID_MIN_ALTITUDE,
      maxZ: GRID_MAX_ALTITUDE,
    });
  });

  it("keeps MLS-smoothed altitudes inside the source altitude range", async () => {
    const { densePoints } = await densify([GRID], {
      density: DENSITY,
      method: "mls",
    });

    expect(densePoints.length).toBeGreaterThan(GRID.points.length);
    densePoints.forEach((point) => {
      expect(point.z).toBeGreaterThanOrEqual(GRID_MIN_ALTITUDE);
      expect(point.z).toBeLessThanOrEqual(GRID_MAX_ALTITUDE);
    });
  });

  it("pads the bounds by 10 units for the interpolation method", async () => {
    const { bounds } = await densify([GRID], {
      density: DENSITY,
      method: "interpolation",
    });

    expect(bounds.minX).toBe(-10);
    expect(bounds.maxX).toBe(50);
    expect(bounds.minY).toBe(-10);
    expect(bounds.maxY).toBe(50);
  });

  it("copies an existing sample altitude verbatim when interpolating", async () => {
    const { densePoints } = await densify([GRID], {
      density: DENSITY,
      method: "interpolation",
    });
    const sourceAltitudes = new Set(GRID.points.map((point) => point.altitude));

    expect(densePoints.length).toBeGreaterThan(0);
    // Nearest-neighbour interpolation never invents a new altitude.
    densePoints.forEach((point) => {
      expect(sourceAltitudes.has(point.z)).toBe(true);
    });
  });

  it("interpolates Delaunay altitudes barycentrically inside the range", async () => {
    const { densePoints } = await densify([GRID], {
      density: DENSITY,
      method: "delaunay",
    });

    expect(densePoints.length).toBeGreaterThan(GRID.points.length);
    densePoints.forEach((point) => {
      expect(point.z).toBeGreaterThanOrEqual(GRID_MIN_ALTITUDE);
      expect(point.z).toBeLessThanOrEqual(GRID_MAX_ALTITUDE);
    });
  });

  it("emits at most one point per grid cell for Delaunay", async () => {
    const { densePoints } = await densify([GRID], {
      density: DENSITY,
      method: "delaunay",
    });
    const keys = densePoints.map((point) => `${point.x},${point.y}`);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("returns no points when Delaunay has fewer than three samples", async () => {
    const sparse = makeProjectedActivity([
      { x: 0, y: 0, altitude: 10 },
      { x: 10, y: 0, altitude: 20 },
    ]);

    const { densePoints } = await densify([sparse], {
      density: DENSITY,
      method: "delaunay",
    });

    expect(densePoints).toEqual([]);
  });

  it("returns no points when no sample carries an altitude", async () => {
    const noAltitude = makeProjectedActivity([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);

    for (const method of ["mls", "interpolation", "delaunay"] as const) {
      const { densePoints } = await densify([noAltitude], {
        density: DENSITY,
        method,
      });
      expect(densePoints).toEqual([]);
    }
  });

  it("handles an empty activity list", async () => {
    const { densePoints } = await densify([], { density: DENSITY });

    expect(densePoints).toEqual([]);
  });

  it("caps the sample count regardless of the requested density", async () => {
    const { densePoints } = await densify([GRID], {
      density: 10_000,
      method: "interpolation",
    });

    // computeAdaptiveStep coarsens the grid so that a runaway density cannot
    // stall the main thread. The cap is 200k samples over the padded extent.
    expect(densePoints.length).toBeLessThanOrEqual(210_000);
  });
});

describe("convertProjectedToLatLng", () => {
  it("uses the projection's inverse when available", () => {
    const projection = {
      invert: ([x, y]: [number, number]): [number, number] => [x / 2, y / 3],
    };

    expect(convertProjectedToLatLng(10, 9, projection)).toEqual({
      lng: 5,
      lat: 3,
    });
  });

  it("falls back to the origin when the projection has no inverse", () => {
    expect(convertProjectedToLatLng(10, 9, {})).toEqual({ lat: 0, lng: 0 });
  });

  it("falls back to the origin when the inverse throws", () => {
    const projection = {
      invert: (): [number, number] => {
        throw new Error("not invertible");
      },
    };

    expect(convertProjectedToLatLng(10, 9, projection)).toEqual({
      lat: 0,
      lng: 0,
    });
  });
});
