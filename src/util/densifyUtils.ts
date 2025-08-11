import Delaunator from "delaunator";
import KDBush from "kdbush";
import type { ProjectedActivity } from "~/app/_components/StravaActivityMapUtils";

function createIndex(points: { x: number; y: number; z: number }[]) {
  // KDBush v4 API: construct with number of items, then add(x, y), then finish()
  const index = new KDBush(points.length, 16, Float32Array);
  for (const p of points) index.add(p.x, p.y);
  index.finish();
  return index;
}

// Removed unused legacy types from ML path

// Removed ML session code

export interface DensePoint {
  x: number;
  y: number;
  z: number; // altitude
  lat: number;
  lng: number;
}

export interface DensificationResult {
  densePoints: DensePoint[];
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
}

/**
 * Compute a grid step that respects both the requested density and a global
 * cap on the number of samples. This prevents main-thread stalls for large
 * extents by adapting resolution to area.
 */
function computeAdaptiveStep(
  requestedDensity: number,
  width: number,
  height: number,
  maxSamples = 200_000,
): number {
  // Density is treated as points per unit distance; base step from density
  const densityStep = 1 / Math.max(1, requestedDensity);
  const area = Math.max(1, width * height);
  const stepFromCap = Math.sqrt(area / Math.max(1, maxSamples));
  // Use the larger (coarser) step to keep samples under the cap
  return Math.max(densityStep, stepFromCap);
}

/**
 * Simple interpolation-based densification as a fallback
 * This creates a grid of points and interpolates elevation values
 */
function interpolateDensePoints(
  projectedActivities: ProjectedActivity[],
  density = 10, // points per unit distance
): DensificationResult {
  // Calculate bounds
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;

  projectedActivities.forEach((activity) => {
    activity.points.forEach((point) => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      if (point.altitude !== undefined) {
        minZ = Math.min(minZ, point.altitude);
        maxZ = Math.max(maxZ, point.altitude);
      }
    });
  });

  // Add padding (reduced to minimize wide flat borders)
  const padding = 10;
  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;

  // Build a spatial index of input points for fast nearest lookups
  const samples: { x: number; y: number; z: number }[] = [];
  projectedActivities.forEach((activity) => {
    activity.points.forEach((p) => {
      if (p.altitude === undefined) return;
      samples.push({ x: p.x, y: p.y, z: p.altitude });
    });
  });

  // If no altitude data, return empty
  if (samples.length === 0) {
    return { densePoints: [], bounds: { minX, maxX, minY, maxY, minZ, maxZ } };
  }

  // KDBush v4: construct with points array and accessors; no add/finish
  const index = createIndex(samples);

  // Create a grid of points using an adaptive step to cap sample count
  const width = maxX - minX;
  const height = maxY - minY;
  const stepSize = computeAdaptiveStep(density, width, height);
  const searchRadius = Math.max(3, stepSize * 2);
  const maxRadius2 = searchRadius * searchRadius;
  const densePoints: DensePoint[] = [];

  for (let x = minX; x <= maxX; x += stepSize) {
    for (let y = minY; y <= maxY; y += stepSize) {
      const ids = index.range(
        x - searchRadius,
        y - searchRadius,
        x + searchRadius,
        y + searchRadius,
      );
      if (ids.length === 0) continue;

      // Find nearest within radius
      let bestD2 = Infinity;
      let bestZ = 0;
      for (const id of ids) {
        const s = samples[id]!;
        const dx = s.x - x;
        const dy = s.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2 && d2 <= maxRadius2) {
          bestD2 = d2;
          bestZ = s.z;
        }
      }

      if (bestD2 !== Infinity) {
        densePoints.push({ x, y, z: bestZ, lat: 0, lng: 0 });
      }
    }
  }

  return {
    densePoints,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}

/**
 * Moving Least Squares (MLS) style densification using a simple Gaussian kernel smoothing
 * and Poisson-disk-like sampling via spatial indexing (KDBush). This avoids ML and is fast in-browser.
 */
function mlsDensification(
  projectedActivities: ProjectedActivity[],
  density = 10,
): DensificationResult {
  // Gather original points
  const samples: { x: number; y: number; z: number }[] = [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;

  projectedActivities.forEach((a) => {
    a.points.forEach((p) => {
      if (p.altitude === undefined) return;
      samples.push({ x: p.x, y: p.y, z: p.altitude });
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.altitude);
      maxZ = Math.max(maxZ, p.altitude);
    });
  });

  if (samples.length === 0) {
    return { densePoints: [], bounds: { minX, maxX, minY, maxY, minZ, maxZ } };
  }

  // Build spatial index
  // KDBush v4: construct with points array and accessors; no add/finish
  const index = createIndex(samples);

  // Grid step derived from density but adapted to cap total samples
  const width = maxX - minX;
  const height = maxY - minY;
  const step = computeAdaptiveStep(density, width, height);
  const searchRadius = Math.max(3, step * 2); // narrower neighborhood radius
  const twoSigma2 = (searchRadius * 0.6) ** 2 * 2; // Gaussian kernel variance

  const densePoints: DensePoint[] = [];
  for (let gx = minX; gx <= maxX; gx += step) {
    for (let gy = minY; gy <= maxY; gy += step) {
      // Neighborhood via bbox query
      const ids = index.range(
        gx - searchRadius,
        gy - searchRadius,
        gx + searchRadius,
        gy + searchRadius,
      );
      if (ids.length === 0) continue;

      // Weighted MLS-like smoothing
      let wsum = 0;
      let zsum = 0;
      for (const id of ids) {
        const s = samples[id]!;
        const dx = s.x - gx;
        const dy = s.y - gy;
        const d2 = dx * dx + dy * dy;
        if (d2 > searchRadius * searchRadius) continue;
        const w = Math.exp(-d2 / Math.max(1e-6, twoSigma2));
        wsum += w;
        zsum += w * s.z;
      }
      if (wsum === 0) continue;
      const gz = zsum / wsum;

      densePoints.push({ x: gx, y: gy, z: gz, lat: 0, lng: 0 });
    }
  }

  return { densePoints, bounds: { minX, maxX, minY, maxY, minZ, maxZ } };
}

/**
 * Delaunay-based densification using Mapbox's delaunator.
 *
 * Strategy:
 *  - Build Delaunay triangulation over input samples
 *  - Iterate each triangle's bounding box on a quantized grid derived from density
 *  - For each quantized point inside the triangle, compute z via barycentric interpolation
 *  - Use a grid-keyed map to avoid duplicate samples across neighboring triangles
 */
function delaunayDensification(
  projectedActivities: ProjectedActivity[],
  density = 10,
): DensificationResult {
  // Collect samples
  const pts: { x: number; y: number; z: number }[] = [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;

  for (const a of projectedActivities) {
    for (const p of a.points) {
      if (p.altitude === undefined) continue;
      pts.push({ x: p.x, y: p.y, z: p.altitude });
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (p.altitude < minZ) minZ = p.altitude;
      if (p.altitude > maxZ) maxZ = p.altitude;
    }
  }

  if (pts.length < 3) {
    return { densePoints: [], bounds: { minX, maxX, minY, maxY, minZ, maxZ } };
  }

  // Compute adaptive step and quantization helpers
  const width = maxX - minX;
  const height = maxY - minY;
  const step = computeAdaptiveStep(density, width, height);
  const invStep = 1 / Math.max(1e-9, step);

  // Prepare coordinates for Delaunator
  const coords = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    coords[2 * i] = pts[i]!.x;
    coords[2 * i + 1] = pts[i]!.y;
  }

  const delaunay = new Delaunator(coords as ArrayLike<number>);
  const triangles = delaunay.triangles; // indices into pts

  // Barycentric helper
  function interpolateZ(
    px: number,
    py: number,
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    c: { x: number; y: number; z: number },
  ): number | null {
    const v0x = b.x - a.x;
    const v0y = b.y - a.y;
    const v1x = c.x - a.x;
    const v1y = c.y - a.y;
    const v2x = px - a.x;
    const v2y = py - a.y;

    const den = v0x * v1y - v1x * v0y;
    if (Math.abs(den) < 1e-12) return null;
    const invDen = 1 / den;
    const u = (v2x * v1y - v1x * v2y) * invDen;
    const v = (v0x * v2y - v2x * v0y) * invDen;
    const w = 1 - u - v;
    if (u < -1e-6 || v < -1e-6 || w < -1e-6) return null; // outside triangle
    return u * b.z + v * c.z + w * a.z;
  }

  // Use a map to dedupe quantized samples
  const seen = new Set<string>();
  const densePoints: DensePoint[] = [];

  // Iterate all triangles
  for (let t = 0; t < triangles.length; t += 3) {
    const ia = triangles[t]!;
    const ib = triangles[t + 1]!;
    const ic = triangles[t + 2]!;
    const A = pts[ia]!;
    const B = pts[ib]!;
    const C = pts[ic]!;

    // Triangle bbox
    const tMinX = Math.min(A.x, B.x, C.x);
    const tMaxX = Math.max(A.x, B.x, C.x);
    const tMinY = Math.min(A.y, B.y, C.y);
    const tMaxY = Math.max(A.y, B.y, C.y);

    // Rasterize over quantized grid inside bbox
    const i0 = Math.floor((tMinX - minX) * invStep);
    const i1 = Math.ceil((tMaxX - minX) * invStep);
    const j0 = Math.floor((tMinY - minY) * invStep);
    const j1 = Math.ceil((tMaxY - minY) * invStep);

    for (let i = i0; i <= i1; i++) {
      const x = minX + i * step;
      for (let j = j0; j <= j1; j++) {
        const y = minY + j * step;
        const z = interpolateZ(x, y, A, B, C);
        if (z == null) continue;
        const key = `${i},${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        densePoints.push({ x, y, z, lat: 0, lng: 0 });
      }
    }
  }

  return { densePoints, bounds: { minX, maxX, minY, maxY, minZ, maxZ } };
}

// Removed PU-Net functions and checks

/**
 * Get available densification methods
 */
type DensifyMethodKey = "mls" | "interpolation" | "delaunay";

const densifyMethods: Record<
  DensifyMethodKey,
  {
    name: string;
    description: string;
    run: (
      activities: ProjectedActivity[],
      density?: number,
    ) => DensificationResult;
  }
> = {
  mls: {
    name: "MLS (Gaussian)",
    description: "MLS-style smoothing on a grid with spatial index",
    run: mlsDensification,
  },
  interpolation: {
    name: "Interpolation",
    description: "Simple grid-based interpolation using nearest neighbor",
    run: interpolateDensePoints,
  },
  delaunay: {
    name: "Delaunay",
    description: "Delaunay triangulation with barycentric interpolation",
    run: delaunayDensification,
  },
};

export async function getAvailableMethods(): Promise<
  Array<{ method: DensifyMethodKey; name: string; description: string }>
> {
  return (Object.keys(densifyMethods) as DensifyMethodKey[]).map((key) => ({
    method: key,
    name: densifyMethods[key].name,
    description: densifyMethods[key].description,
  }));
}

/**
 * Main densification function
 * @param projectedActivities - The projected activity data
 * @param options - Configuration options
 * @returns Promise<DensificationResult> - The densified points and bounds
 */
export async function densify(
  projectedActivities: ProjectedActivity[],
  options: {
    method?: DensifyMethodKey | "auto";
    density?: number;
    debug?: boolean;
  } = {},
): Promise<DensificationResult> {
  const { method = "auto", density = 10, debug = false } = options;

  if (debug) {
    console.log("🔍 Densification Debug Info:");
    console.log(`- Method: ${method}`);
    console.log(`- Density: ${density}`);
    console.log(`- Input activities: ${projectedActivities.length}`);
    console.log(
      `- Total input points: ${projectedActivities.reduce((sum, a) => sum + a.points.length, 0)}`,
    );
  }

  try {
    let selectedMethod: DensifyMethodKey | "auto" = method;

    // Auto-select method
    if (method === "auto") {
      selectedMethod = "mls";
      if (debug) {
        console.log(`- Auto-selected method: ${selectedMethod}`);
      }
    }

    const key = selectedMethod as DensifyMethodKey;
    const impl = densifyMethods[key];
    const result = impl.run(projectedActivities, density);
    if (debug) {
      console.log(
        `✅ ${impl.name} completed: ${result.densePoints.length} points generated`,
      );
    }
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(
      `Densification failed (${method}), falling back to interpolation:`,
      errorMsg,
    );

    const result = densifyMethods.interpolation.run(
      projectedActivities,
      density,
    );
    if (debug) {
      console.log(
        `✅ Fallback interpolation completed: ${result.densePoints.length} points generated`,
      );
    }
    return result;
  }
}

/**
 * Convert projected coordinates back to lat/lng
 * This is a simplified conversion - you may need to implement proper inverse projection
 */
export function convertProjectedToLatLng(
  x: number,
  y: number,
  projection: { invert?: (coords: [number, number]) => [number, number] },
): { lat: number; lng: number } {
  // This is a placeholder - you'll need to implement proper inverse projection
  // based on your specific projection method
  try {
    const [lng, lat] = projection.invert?.([x, y]) ?? [0, 0];
    return { lat, lng };
  } catch {
    // Fallback to approximate conversion
    return { lat: 0, lng: 0 };
  }
}
