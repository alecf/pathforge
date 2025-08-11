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

    // Create position array for all points
    const positions = new Float32Array(densePoints.length * 3);

    densePoints.forEach((point, index) => {
      const i = index * 3;
      positions[i] = point.x; // X coordinate
      positions[i + 1] = point.z; // Y coordinate (altitude)
      positions[i + 2] = point.y; // Z coordinate (depth)
    });

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
        let trailness = 0;
        if (projectedActivities && projectedActivities.length > 0) {
          const r2 = highlightRadius * highlightRadius;
          outer: for (const a of projectedActivities) {
            const pts = a.points;
            for (let k = 0; k < pts.length - 1; k++) {
              const p0 = pts[k]!;
              const p1 = pts[k + 1]!;
              const vx = p1.x - p0.x;
              const vy = p1.y - p0.y;
              const wx = x - p0.x;
              const wy = y - p0.y;
              const vv = vx * vx + vy * vy || 1e-9;
              let t = (wx * vx + wy * vy) / vv;
              t = Math.max(0, Math.min(1, t));
              const projx = p0.x + t * vx;
              const projy = p0.y + t * vy;
              const dx = x - projx;
              const dy = y - projy;
              const d2 = dx * dx + dy * dy;
              if (d2 <= r2) {
                trailness = 1;
                break outer;
              }
            }
          }
        }
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
}

export function AdaptiveTerrainSurface({
  densePoints,
  color = "#4ade80",
  opacity = 0.35,
  projectedActivities,
  maxEdgeLength,
  mapBounds,
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

    // Positions: use densePoints order for vertex buffer
    const positions = new Float32Array(densePoints.length * 3);
    for (let i = 0; i < densePoints.length; i++) {
      const p = densePoints[i]!;
      const j = i * 3;
      positions[j] = p.x;
      positions[j + 1] = p.z;
      positions[j + 2] = p.y;
    }
    geom.setAttribute("position", new Float32BufferAttribute(positions, 3));

    // Delaunay triangulation over XY
    const coords = new Float64Array(densePoints.length * 2);
    for (let i = 0; i < densePoints.length; i++) {
      const p = densePoints[i]!;
      coords[2 * i] = p.x;
      coords[2 * i + 1] = p.y;
    }
    const DelaunatorCtor = Delaunator as unknown as new (
      coords: ArrayLike<number>,
    ) => { triangles: Uint32Array };
    const delaunay = new DelaunatorCtor(coords as ArrayLike<number>);
    const triIdx: number[] = [];

    const maxEdge =
      maxEdgeLength ??
      (() => {
        // estimate from nearest-neighbor spacing
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        for (const p of densePoints) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const area = Math.max(1, (maxX - minX) * (maxY - minY));
        const meanStep = Math.sqrt(area / Math.max(1, densePoints.length));
        return meanStep * 6; // drop very long skinny triangles
      })();

    const tris: Uint32Array = delaunay.triangles;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] ?? 0;
      const b = tris[t + 1] ?? 0;
      const c = tris[t + 2] ?? 0;
      const pa = densePoints[a]!;
      const pb = densePoints[b]!;
      const pc = densePoints[c]!;
      const ab = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const bc = Math.hypot(pc.x - pb.x, pc.y - pb.y);
      const ca = Math.hypot(pa.x - pc.x, pa.y - pc.y);
      if (ab > maxEdge || bc > maxEdge || ca > maxEdge) continue;
      triIdx.push(a, b, c);
    }
    // If bounds are provided, add a thin rim of boundary triangles so the surface reaches the map edges
    if (mapBounds) {
      const { minX, maxX, minY, maxY } = mapBounds;
      const rimStep = maxEdge / 2;
      const rimPoints: DensePoint[] = [];
      for (let x = minX; x <= maxX; x += rimStep) {
        rimPoints.push({ x, y: minY, z: 0, lat: 0, lng: 0 });
        rimPoints.push({ x, y: maxY, z: 0, lat: 0, lng: 0 });
      }
      for (let y = minY; y <= maxY; y += rimStep) {
        rimPoints.push({ x: minX, y, z: 0, lat: 0, lng: 0 });
        rimPoints.push({ x: maxX, y, z: 0, lat: 0, lng: 0 });
      }
      const baseIndex = densePoints.length;
      if (rimPoints.length) {
        // Append rim positions, flattened at z=0 so it smoothly fades
        const newPositions = new Float32Array(
          (densePoints.length + rimPoints.length) * 3,
        );
        newPositions.set(positions);
        for (let i = 0; i < rimPoints.length; i++) {
          const p = rimPoints[i]!;
          const j = (baseIndex + i) * 3;
          newPositions[j] = p.x;
          newPositions[j + 1] = p.z; // 0
          newPositions[j + 2] = p.y;
        }
        geom.setAttribute(
          "position",
          new Float32BufferAttribute(newPositions, 3),
        );
        // Create simple quads along edges by connecting to nearest existing vertices using coarse gridding
        // For simplicity, skip re-triangulating via Delaunay and add skinny triangles to edges
        // Left/right edges
        for (let y = minY; y < maxY; y += rimStep) {
          const i0 =
            baseIndex +
            Math.floor(
              ((y - minY) / rimStep) * 2 +
                (2 * Math.floor((maxX - minX) / rimStep) + 2) * 1,
            );
          const i1 = i0 + 2;
          // Find nearest interior points at same y via linear scan (small set)
          let nearestL = -1;
          let nearestR = -1;
          let bestLd = Infinity,
            bestRd = Infinity;
          for (let vi = 0; vi < densePoints.length; vi++) {
            const p = densePoints[vi]!;
            if (Math.abs(p.y - y) > rimStep) continue;
            if (p.x < minX + rimStep && minX - p.x < bestLd) {
              bestLd = minX - p.x;
              nearestL = vi;
            }
            if (p.x > maxX - rimStep && p.x - maxX < bestRd) {
              bestRd = p.x - maxX;
              nearestR = vi;
            }
          }
          if (nearestL >= 0) triIdx.push(nearestL, i0, i0 + 2);
          if (nearestR >= 0) triIdx.push(nearestR, i1, i1 + 2);
        }
      }
    }
    geom.setIndex(triIdx);
    geom.computeVertexNormals();

    // Build per-vertex colors: altitude/slope shading + trail proximity
    let normalsAttr = geom.getAttribute("normal");
    if (!normalsAttr) {
      geom.computeVertexNormals();
      normalsAttr = geom.getAttribute("normal");
    }
    const normals = normalsAttr as Float32BufferAttribute;
    const colorArray: number[] = new Array(densePoints.length * 3).fill(0);
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
      ? new Array(densePoints.length * 3).fill(0)
      : undefined;
    if (trailColors) {
      // For each vertex, check shortest distance to any segment (cheap O(N*M) for moderate sizes)
      // Make highlight radius much narrower (~10% of prior)
      const r = (maxEdgeLength ?? Math.sqrt(denom) + 1) * 0.075;
      const r2 = r * r;
      for (let i = 0; i < densePoints.length; i++) {
        const vx = densePoints[i]!.x;
        const vy = densePoints[i]!.y;
        let onTrail = false;
        outer: for (const a of projectedActivities ?? []) {
          const pts = a.points;
          for (let k = 0; k < pts.length - 1; k++) {
            const p0 = pts[k]!;
            const p1 = pts[k + 1]!;
            const sx = p1.x - p0.x;
            const sy = p1.y - p0.y;
            const wx = vx - p0.x;
            const wy = vy - p0.y;
            const ss = sx * sx + sy * sy || 1e-9;
            let t = (wx * sx + wy * sy) / ss;
            t = Math.max(0, Math.min(1, t));
            const cx = p0.x + t * sx;
            const cy = p0.y + t * sy;
            const dx = vx - cx;
            const dy = vy - cy;
            if (dx * dx + dy * dy <= r2) {
              onTrail = true;
              break outer;
            }
          }
        }
        const idx3 = i * 3;
        const baseCol = new Color(color);
        const mix = baseCol.clone().lerp(trailColor, onTrail ? 1 : 0);
        trailColors[idx3] = mix.r;
        trailColors[idx3 + 1] = mix.g;
        trailColors[idx3 + 2] = mix.b;
      }
    }

    for (let i = 0; i < densePoints.length; i++) {
      const p = densePoints[i]!;
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
      `✅ Adaptive surface regenerated: vertices=${densePoints.length}, triangles=${triIdx.length / 3}, took ${(
        end - start
      ).toFixed(1)}ms`,
    );

    return geom;
  }, [densePoints, color, projectedActivities, maxEdgeLength, mapBounds]);

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
