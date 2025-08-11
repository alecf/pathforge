"use client";

import Delaunator from "delaunator";
import { useMemo } from "react";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  PointsMaterial,
} from "three";
import type { DensePoint } from "~/util/densifyUtils";
import {
  type SegmentGridIndex,
  isPointNearAnySegment,
} from "~/util/spatialIndex";

// Estimate a reasonable maximum edge length for triangulation from point distribution
function estimateMaxEdgeLengthFromPoints(densePoints: DensePoint[]): number {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const point of densePoints) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const area = Math.max(1, (maxX - minX) * (maxY - minY));
  const meanStep = Math.sqrt(area / Math.max(1, densePoints.length));
  return meanStep * 6; // drop very long skinny triangles
}

// Build [x,y] coordinate array for Delaunay using a flatMap transformation
function buildDelaunayCoords(points: DensePoint[]): Float64Array {
  return new Float64Array(points.flatMap((p) => [p.x, p.y]));
}

// (previous boundary rim helper removed; rim is now baked into augmentedPoints before triangulation)

interface DenseTerrainMeshProps {
  densePoints: DensePoint[];
  pointSize?: number;
  color?: string;
  opacity?: number;
}

export function DenseTerrainMesh({
  densePoints,
  pointSize = 2,
  color = "#4ade80",
  opacity = 0.6,
}: DenseTerrainMeshProps) {
  const pointsGeometry = useMemo(() => {
    const geometry = new BufferGeometry();

    // Create position array for all points via flatMap -> typed array
    const positions = Float32Array.from(
      densePoints.flatMap((point) => [point.x, point.z, point.y]),
    );

    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));

    return geometry;
  }, [densePoints]);

  const pointsMaterial = useMemo(() => {
    return new PointsMaterial({
      size: pointSize,
      color: color,
      transparent: true,
      opacity: opacity,
      sizeAttenuation: true,
    });
  }, [pointSize, color, opacity]);

  return <points geometry={pointsGeometry} material={pointsMaterial} />;
}

interface DenseTerrainSurfaceProps {
  densePoints: DensePoint[];
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
  resolution?: number;
  color?: string;
  opacity?: number;
  projectedActivities?: Array<{
    id?: string | number;
    points: { x: number; y: number }[];
  }>;
  highlightRadius?: number;
  segmentIndex?: SegmentGridIndex;
}

/**
 * Alternative rendering method that creates a surface mesh
 * This can be more performant for large datasets
 */
export function DenseTerrainSurface({
  densePoints,
  bounds,
  resolution = 50,
  color = "#4ade80",
  opacity = 0.3,
  projectedActivities,
  highlightRadius = 5,
  segmentIndex,
}: DenseTerrainSurfaceProps) {
  const surfaceGeometry = useMemo(() => {
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `🛠️ Regenerating surface… (resolution=${resolution}, densePoints=${densePoints.length})`,
    );
    const geometry = new BufferGeometry();

    // Create a grid-based surface from the dense points
    const { minX, maxX, minY, maxY, minZ, maxZ } = bounds;
    const stepX = (maxX - minX) / resolution;
    const stepY = (maxY - minY) / resolution;

    const positions: number[] = [];
    const indices: number[] = [];
    const altitudes: number[] = [];
    const colors: number[] = [];
    const trailColor = new Color("#8B4513");

    // Create vertices for the surface
    for (let i = 0; i <= resolution; i++) {
      for (let j = 0; j <= resolution; j++) {
        const x = minX + i * stepX;
        const y = minY + j * stepY;

        // Find the closest dense point to get elevation
        let closestZ = minZ;
        let closestDistance = Infinity;

        densePoints.forEach((point) => {
          const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestZ = point.z;
          }
        });

        positions.push(x, closestZ, y);
        altitudes.push(closestZ);
        // proximity-based color blending to show trails on the surface
        const trailness = segmentIndex
          ? isPointNearAnySegment(segmentIndex, x, y, highlightRadius)
            ? 1
            : 0
          : computeTrailnessAtPoint(projectedActivities, highlightRadius, x, y);
        // Mix base surface color with trail color based on trailness (0 or 1)
        const baseCol = new Color(color);
        const mixed = baseCol.clone().lerp(trailColor, trailness);
        colors.push(mixed.r, mixed.g, mixed.b);
      }
    }

    // Create triangles for the surface
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const a = i * (resolution + 1) + j;
        const b = a + 1;
        const c = (i + 1) * (resolution + 1) + j;
        const d = c + 1;

        // First triangle
        indices.push(a, b, c);
        // Second triangle
        indices.push(b, d, c);
      }
    }

    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Build subtle vertex colors using altitude and local slope (from normals)
    let normalsAttr = geometry.getAttribute("normal");
    if (!normalsAttr) {
      geometry.computeVertexNormals();
      normalsAttr = geometry.getAttribute("normal");
    }
    const normals = normalsAttr as Float32BufferAttribute;
    const colorArray: number[] = [];
    const base = new Color(color);
    const baseHSL = { h: 0, s: 0, l: 0 } as { h: number; s: number; l: number };
    base.getHSL(baseHSL);
    const denom = Math.max(1e-6, maxZ - minZ);
    for (let i = 0; i < altitudes.length; i++) {
      const alt = altitudes[i] ?? minZ;
      const tAlt = Math.min(1, Math.max(0, (alt - minZ) / denom));
      const ny = Math.max(0, Math.min(1, normals.getY(i)));
      const slope = 1 - ny; // 0 flat, 1 vertical

      // Gentle adjustments: a touch lighter with altitude, slightly darker with slope
      const lightness = Math.max(
        0,
        Math.min(1, baseHSL.l * 0.85 + tAlt * 0.15 - slope * 0.1),
      );
      const saturation = Math.max(
        0,
        Math.min(1, baseHSL.s * 0.95 + slope * 0.12),
      );
      // Combine subtle shading with trail color by lerping towards existing trail-mixed color
      const shaded = new Color().setHSL(baseHSL.h, saturation, lightness);
      // component offset into flat RGB array (r,g,b per vertex)
      const idx3 = i * 3;
      const hasTrail = colors.length === altitudes.length * 3;
      if (hasTrail) {
        const r = colors[idx3] ?? 0;
        const g = colors[idx3 + 1] ?? 0;
        const b = colors[idx3 + 2] ?? 0;
        const c = new Color(r, g, b);
        // Average the two to keep trail visible with shading
        const finalCol = shaded.clone().lerp(c, 0.6);
        colorArray.push(finalCol.r, finalCol.g, finalCol.b);
      } else {
        colorArray.push(shaded.r, shaded.g, shaded.b);
      }
    }
    geometry.setAttribute("color", new Float32BufferAttribute(colorArray, 3));

    const end =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const vertexCount = positions.length / 3;
    const triCount = indices.length / 3;
    console.log(
      `✅ Surface regenerated: vertices=${vertexCount}, triangles=${triCount}, took ${(
        end - start
      ).toFixed(1)}ms`,
    );
    return geometry;
  }, [
    densePoints,
    bounds,
    resolution,
    color,
    projectedActivities,
    highlightRadius,
    segmentIndex,
  ]);

  return (
    <mesh geometry={surfaceGeometry}>
      <meshStandardMaterial
        color={color}
        transparent={true}
        opacity={opacity}
        side={2} // DoubleSide
        vertexColors
        roughness={0.95}
        metalness={0}
      />
    </mesh>
  );
}

interface AdaptiveTerrainSurfaceProps {
  densePoints: DensePoint[];
  color?: string;
  opacity?: number;
  projectedActivities?: Array<{
    id?: string | number;
    points: { x: number; y: number }[];
  }>;
  maxEdgeLength?: number; // in projected units; triangles with longer edges are dropped
  mapBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  segmentIndex?: SegmentGridIndex;
}

/**
 * Compute trailness (0 or 1) for a surface point based on proximity to any
 * activity polyline segment. Returns 1 on first segment within radius; else 0.
 */
function computeTrailnessAtPoint(
  projectedActivities:
    | { id?: string | number; points: { x: number; y: number }[] }[]
    | undefined,
  highlightRadius: number,
  x: number,
  y: number,
): number {
  if (!projectedActivities || projectedActivities.length === 0) return 0;
  if (!Number.isFinite(highlightRadius) || highlightRadius <= 0) return 0;

  // Use squared radius so we can compare squared distances without computing costly square roots.
  // sqrt is monotonic, so (dx^2 + dy^2) <= r^2 is equivalent to distance <= r.
  const radiusSquared = highlightRadius * highlightRadius;

  for (const activity of projectedActivities) {
    const points = activity.points;
    if (!points || points.length < 2) continue;
    for (let k = 0; k < points.length - 1; k++) {
      const p0 = points[k]!;
      const p1 = points[k + 1]!;
      const segX = p1.x - p0.x;
      const segY = p1.y - p0.y;
      const toPointX = x - p0.x;
      const toPointY = y - p0.y;
      const segLen2 = segX * segX + segY * segY || 1e-9;
      let t = (toPointX * segX + toPointY * segY) / segLen2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const closestX = p0.x + t * segX;
      const closestY = p0.y + t * segY;
      const dx = x - closestX;
      const dy = y - closestY;
      if (dx * dx + dy * dy <= radiusSquared) return 1;
    }
  }
  return 0;
}

/**
 * Boolean variant: checks whether a point (vertexX, vertexY) is within
 * searchRadius of any projected activity polyline segment.
 * Uses early returns for clarity.
 */
function isVertexOnAnyActivityTrail(
  projectedActivities:
    | { id?: string | number; points: { x: number; y: number }[] }[]
    | undefined,
  vertexX: number,
  vertexY: number,
  searchRadius: number,
): boolean {
  if (!projectedActivities || projectedActivities.length === 0) return false;
  if (!Number.isFinite(searchRadius) || searchRadius <= 0) return false;

  // Same squared-distance trick here: avoid Math.sqrt by comparing to r^2 directly.
  const radiusSquared = searchRadius * searchRadius;

  for (const activity of projectedActivities) {
    const polyline = activity.points;
    if (!polyline || polyline.length < 2) continue;

    for (
      let segmentIndex = 0;
      segmentIndex < polyline.length - 1;
      segmentIndex++
    ) {
      const start = polyline[segmentIndex]!;
      const end = polyline[segmentIndex + 1]!;

      const segmentDeltaX = end.x - start.x;
      const segmentDeltaY = end.y - start.y;
      const fromStartToVertexX = vertexX - start.x;
      const fromStartToVertexY = vertexY - start.y;

      const segmentLengthSquared =
        segmentDeltaX * segmentDeltaX + segmentDeltaY * segmentDeltaY || 1e-9;
      let unitT =
        (fromStartToVertexX * segmentDeltaX +
          fromStartToVertexY * segmentDeltaY) /
        segmentLengthSquared;
      if (unitT < 0) unitT = 0;
      else if (unitT > 1) unitT = 1;

      const closestPointX = start.x + unitT * segmentDeltaX;
      const closestPointY = start.y + unitT * segmentDeltaY;

      const distanceX = vertexX - closestPointX;
      const distanceY = vertexY - closestPointY;

      // Squared distance from vertex to closest point on segment
      const distanceSquared = distanceX * distanceX + distanceY * distanceY;
      if (distanceSquared <= radiusSquared) return true;
    }
  }

  return false;
}

export function AdaptiveTerrainSurface({
  densePoints,
  color = "#4ade80",
  opacity = 0.35,
  projectedActivities,
  maxEdgeLength,
  mapBounds,
  segmentIndex,
}: AdaptiveTerrainSurfaceProps) {
  const geometry = useMemo(() => {
    const start =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `🛠️ Regenerating adaptive surface… (points=${densePoints.length})`,
    );

    const geom = new BufferGeometry();
    if (densePoints.length < 3) {
      return geom;
    }

    // Estimate max edge length once (used for rim spacing if provided)
    const maxEdge =
      maxEdgeLength ?? estimateMaxEdgeLengthFromPoints(densePoints);

    // Optionally augment with a boundary rim prior to triangulation so the
    // surface properly reaches the map edges
    let augmentedPoints: DensePoint[] = densePoints;
    if (mapBounds) {
      const { minX, maxX, minY, maxY } = mapBounds;
      const rimStep = Math.max(1e-3, maxEdge / 2);
      const rimPoints: DensePoint[] = [];
      // Top and bottom edges
      for (let x = minX; x <= maxX; x += rimStep) {
        rimPoints.push({ x, y: minY, z: 0, lat: 0, lng: 0 });
        rimPoints.push({ x, y: maxY, z: 0, lat: 0, lng: 0 });
      }
      // Left and right edges
      for (let y = minY; y <= maxY; y += rimStep) {
        rimPoints.push({ x: minX, y, z: 0, lat: 0, lng: 0 });
        rimPoints.push({ x: maxX, y, z: 0, lat: 0, lng: 0 });
      }
      if (rimPoints.length > 0) {
        augmentedPoints = densePoints.concat(rimPoints);
      }
    }

    // Positions: use augmented order for vertex buffer
    const positions = Float32Array.from(
      augmentedPoints.flatMap((p) => [p.x, p.z, p.y]),
    );
    geom.setAttribute("position", new Float32BufferAttribute(positions, 3));

    // Delaunay triangulation over XY (use augmented points)
    const coords = buildDelaunayCoords(augmentedPoints);
    const delaunay = new Delaunator(coords as ArrayLike<number>);
    // Triangle index buffer (triplets of vertex indices)
    const triangleIndices: number[] = [];

    const tris: Uint32Array = delaunay.triangles;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] ?? 0;
      const b = tris[t + 1] ?? 0;
      const c = tris[t + 2] ?? 0;
      const pa = augmentedPoints[a]!;
      const pb = augmentedPoints[b]!;
      const pc = augmentedPoints[c]!;
      const ab = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const bc = Math.hypot(pc.x - pb.x, pc.y - pb.y);
      const ca = Math.hypot(pa.x - pc.x, pa.y - pc.y);
      if (ab > maxEdge || bc > maxEdge || ca > maxEdge) continue;
      triangleIndices.push(a, b, c);
    }
    geom.setIndex(triangleIndices);
    geom.computeVertexNormals();

    // Build per-vertex colors: altitude/slope shading + trail proximity
    let normalsAttr = geom.getAttribute("normal");
    if (!normalsAttr) {
      geom.computeVertexNormals();
      normalsAttr = geom.getAttribute("normal");
    }
    const normals = normalsAttr as Float32BufferAttribute;
    const colorArray: number[] = new Array(augmentedPoints.length * 3).fill(0);
    const base = new Color(color);
    const baseHSL = { h: 0, s: 0, l: 0 } as { h: number; s: number; l: number };
    base.getHSL(baseHSL);
    // altitude range approx from points
    let minZ = Infinity,
      maxZ = -Infinity;
    for (const p of densePoints) {
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const denom = Math.max(1e-6, maxZ - minZ);

    // Optional trail proximity coloring
    const trailColor = new Color("#A0522D"); // sienna (lighter dirt tone)
    const trailColors: number[] | undefined = projectedActivities?.length
      ? new Array(augmentedPoints.length * 3).fill(0)
      : undefined;
    if (trailColors) {
      // For each vertex, check shortest distance to any segment (cheap O(N*M) for moderate sizes)
      // Make highlight radius much narrower (~10% of prior)
      const r = (maxEdgeLength ?? Math.sqrt(denom) + 1) * 0.075;
      for (let i = 0; i < augmentedPoints.length; i++) {
        const vx = augmentedPoints[i]!.x;
        const vy = augmentedPoints[i]!.y;
        const onTrail = segmentIndex
          ? isPointNearAnySegment(segmentIndex, vx, vy, r)
          : isVertexOnAnyActivityTrail(projectedActivities, vx, vy, r);
        const idx3 = i * 3;
        const baseCol = new Color(color);
        const mix = baseCol.clone().lerp(trailColor, onTrail ? 1 : 0);
        trailColors[idx3] = mix.r;
        trailColors[idx3 + 1] = mix.g;
        trailColors[idx3 + 2] = mix.b;
      }
    }

    for (let i = 0; i < augmentedPoints.length; i++) {
      const p = augmentedPoints[i]!;
      const tAlt = Math.min(1, Math.max(0, (p.z - minZ) / denom));
      const ny = Math.max(0, Math.min(1, normals.getY(i)));
      const slope = 1 - ny;
      const lightness = Math.max(
        0,
        Math.min(1, baseHSL.l * 0.85 + tAlt * 0.15 - slope * 0.1),
      );
      const saturation = Math.max(
        0,
        Math.min(1, baseHSL.s * 0.95 + slope * 0.12),
      );
      const shaded = new Color().setHSL(baseHSL.h, saturation, lightness);
      // component offset into flat RGB array (r,g,b per vertex)
      const idx3 = i * 3;
      if (trailColors) {
        const r = trailColors[idx3] ?? 0;
        const g = trailColors[idx3 + 1] ?? 0;
        const b = trailColors[idx3 + 2] ?? 0;
        const c = new Color(r, g, b);
        const finalCol = shaded.clone().lerp(c, 0.6);
        colorArray[idx3] = finalCol.r;
        colorArray[idx3 + 1] = finalCol.g;
        colorArray[idx3 + 2] = finalCol.b;
      } else {
        colorArray[idx3] = shaded.r;
        colorArray[idx3 + 1] = shaded.g;
        colorArray[idx3 + 2] = shaded.b;
      }
    }
    geom.setAttribute("color", new Float32BufferAttribute(colorArray, 3));

    const end =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `✅ Adaptive surface regenerated: vertices=${densePoints.length}, triangles=${triangleIndices.length / 3}, took ${(
        end - start
      ).toFixed(1)}ms`,
    );

    return geom;
  }, [
    densePoints,
    color,
    projectedActivities,
    maxEdgeLength,
    mapBounds,
    segmentIndex,
  ]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        transparent={true}
        opacity={opacity}
        side={2}
        vertexColors
        roughness={0.95}
        metalness={0}
      />
    </mesh>
  );
}
