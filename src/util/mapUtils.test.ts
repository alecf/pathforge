import * as d3 from "d3";
import { describe, expect, it } from "vitest";

import { SAMPLE_POLYLINE, makeActivity } from "~/test/fixtures";
import {
  calculateAltitudeBounds,
  deriveGridSpacings,
  estimateProjectedUnitsPerMile,
  getMilesPerDegree,
  metersToMiles,
  milesToMeters,
} from "./mapUtils";

const BOUNDS = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };

/**
 * `estimateProjectedUnitsPerMile` has to cope with a projection that declines
 * to project a coordinate (d3 returns `null` outside the clip extent), which is
 * awkward to provoke on a real projection, so stand one in.
 */
function nullProjection(): d3.GeoProjection {
  const projection = () => null;
  return projection as unknown as d3.GeoProjection;
}

describe("unit conversions", () => {
  it("converts miles to meters using the international mile", () => {
    expect(milesToMeters(1)).toBe(1609.344);
    expect(milesToMeters(0)).toBe(0);
  });

  it("round-trips miles through meters", () => {
    expect(metersToMiles(milesToMeters(3.7))).toBeCloseTo(3.7, 10);
  });
});

describe("getMilesPerDegree", () => {
  it("returns 69 miles per degree in both axes at the equator", () => {
    const { milesPerDegreeLat, milesPerDegreeLng } = getMilesPerDegree(0);

    expect(milesPerDegreeLat).toBe(69);
    expect(milesPerDegreeLng).toBeCloseTo(69, 10);
  });

  it("shrinks longitude degrees by cos(latitude)", () => {
    const { milesPerDegreeLng } = getMilesPerDegree(60);

    expect(milesPerDegreeLng).toBeCloseTo(34.5, 6);
  });

  it("clamps longitude degrees to a positive floor at the poles", () => {
    const { milesPerDegreeLng } = getMilesPerDegree(90);

    expect(milesPerDegreeLng).toBeGreaterThan(0);
    expect(milesPerDegreeLng).toBeLessThanOrEqual(1e-6);
  });

  it("is symmetric about the equator", () => {
    expect(getMilesPerDegree(45).milesPerDegreeLng).toBeCloseTo(
      getMilesPerDegree(-45).milesPerDegreeLng,
      10,
    );
  });
});

describe("estimateProjectedUnitsPerMile", () => {
  it("scales with the projection scale", () => {
    const small = estimateProjectedUnitsPerMile(
      d3.geoMercator().scale(1000),
      -122.4,
      37.8,
    );
    const large = estimateProjectedUnitsPerMile(
      d3.geoMercator().scale(4000),
      -122.4,
      37.8,
    );

    expect(small).toBeGreaterThan(0);
    expect(large).toBeCloseTo(small! * 4, 6);
  });

  it("returns null when the projection cannot project the point", () => {
    expect(estimateProjectedUnitsPerMile(nullProjection(), 0, 0)).toBeNull();
  });
});

describe("deriveGridSpacings", () => {
  it("falls back to the 50/200 defaults when the projection fails", () => {
    expect(deriveGridSpacings(nullProjection(), 0, 0, BOUNDS)).toEqual({
      cellSize: 50,
      sectionSize: 200,
    });
  });

  it("makes the minor grid a quarter of the major grid", () => {
    const { cellSize, sectionSize } = deriveGridSpacings(
      d3.geoMercator().scale(200_000),
      -122.4,
      37.8,
      { minX: 0, maxX: 1e6, minY: 0, maxY: 1e6 },
    );

    expect(cellSize).toBeCloseTo(sectionSize * 0.25, 6);
  });

  it("clamps the major grid to half the widest extent", () => {
    // A very large scale would put a mile well beyond the viewport, so the
    // spacing has to be scaled back down to stay useful.
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    const { cellSize, sectionSize } = deriveGridSpacings(
      d3.geoMercator().scale(10_000_000),
      -122.4,
      37.8,
      bounds,
    );

    expect(sectionSize).toBeLessThanOrEqual(Math.max(10, 100 / 2));
    expect(cellSize).toBeCloseTo(sectionSize * 0.25, 6);
  });
});

describe("calculateAltitudeBounds", () => {
  it("spans the altitudes of every activity", () => {
    const first = makeActivity({
      id: 1,
      detailedPoints: [
        {
          lat: 0,
          lng: 0,
          altitude: 10,
          lnglat_resolution: "high",
          altitude_resolution: "high",
        },
        {
          lat: 1,
          lng: 1,
          altitude: 90,
          lnglat_resolution: "high",
          altitude_resolution: "high",
        },
      ],
    });
    const second = makeActivity({
      id: 2,
      detailedPoints: [
        {
          lat: 2,
          lng: 2,
          altitude: 5,
          lnglat_resolution: "high",
          altitude_resolution: "high",
        },
      ],
    });

    expect(calculateAltitudeBounds([first, second])).toEqual({
      minAltitude: 5,
      maxAltitude: 90,
      hasAltitudeData: true,
    });
  });

  it("collapses to zero when nothing carries altitude", () => {
    expect(
      calculateAltitudeBounds([makeActivity({ polyline: SAMPLE_POLYLINE })]),
    ).toEqual({ minAltitude: 0, maxAltitude: 0, hasAltitudeData: false });
  });

  it("collapses to zero for an empty activity list", () => {
    expect(calculateAltitudeBounds([])).toEqual({
      minAltitude: 0,
      maxAltitude: 0,
      hasAltitudeData: false,
    });
  });
});
