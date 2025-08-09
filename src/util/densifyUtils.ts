import KDBush from "kdbush";
import type { ProjectedActivity } from "~/app/_components/StravaActivityMapUtils";

type KDBushIndex = {
  add: (i: number) => void;
  finish: () => void;
  range: (minX: number, minY: number, maxX: number, maxY: number) => number[];
};

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

// Keeping types if needed later, but not used in non-ML path
type Point3 = [number, number, number];

type NormalizationParams = {
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
};

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

  // Add padding
  const padding = 50;
  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;

  // Create a grid of points
  const stepSize = 1 / density;
  const densePoints: DensePoint[] = [];

  for (let x = minX; x <= maxX; x += stepSize) {
    for (let y = minY; y <= maxY; y += stepSize) {
      // Find the closest activity point to interpolate altitude
      let closestDistance = Infinity;
      let closestAltitude = 0;

      projectedActivities.forEach((activity) => {
        activity.points.forEach((point) => {
          const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
          if (distance < closestDistance && point.altitude !== undefined) {
            closestDistance = distance;
            closestAltitude = point.altitude;
          }
        });
      });

      // Only add points that are reasonably close to activity paths
      if (closestDistance < 100) {
        // Within 100 units of an activity
        densePoints.push({
          x,
          y,
          z: closestAltitude,
          lat: 0, // We'll need to convert back from projected coordinates
          lng: 0,
        });
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
  type KDBushCtor = new (
    length: number,
    getX: (i: number) => number,
    getY: (i: number) => number,
    nodeSize?: number,
    ArrayType?: Float32ArrayConstructor,
  ) => KDBushIndex;
  const KDBushClass = KDBush as unknown as KDBushCtor;
  const index: KDBushIndex = new KDBushClass(
    samples.length,
    (i: number) => samples[i]!.x,
    (i: number) => samples[i]!.y,
    16,
    Float32Array,
  );
  for (let i = 0; i < samples.length; i++) index.add(i);
  index.finish();

  // Grid step derived from density
  const step = 1 / Math.max(1, density);
  const searchRadius = step * 5; // neighborhood radius
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

// Removed PU-Net functions and checks

/**
 * Get available densification methods
 */
export async function getAvailableMethods(): Promise<
  Array<{ method: string; name: string; description: string }>
> {
  return [
    {
      method: "mls",
      name: "MLS (Gaussian)",
      description: "MLS-style smoothing on a grid with spatial index",
    },
    {
      method: "interpolation",
      name: "Interpolation",
      description: "Simple grid-based interpolation using nearest neighbor",
    },
  ];
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
    method?: "interpolation" | "auto" | "mls";
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
    let selectedMethod = method;

    // Auto-select method
    if (method === "auto") {
      selectedMethod = "mls";
      if (debug) {
        console.log(`- Auto-selected method: ${selectedMethod}`);
      }
    }

    if (selectedMethod === "mls") {
      const result = mlsDensification(projectedActivities, density);
      if (debug) {
        console.log(
          `✅ MLS completed: ${result.densePoints.length} points generated`,
        );
      }
      return result;
    } else {
      const result = interpolateDensePoints(projectedActivities, density);
      if (debug) {
        console.log(
          `✅ Interpolation completed: ${result.densePoints.length} points generated`,
        );
      }
      return result;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn(
      `Densification failed (${method}), falling back to interpolation:`,
      errorMsg,
    );

    const result = interpolateDensePoints(projectedActivities, density);
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
