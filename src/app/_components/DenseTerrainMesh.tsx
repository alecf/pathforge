"use client";

import { useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, PointsMaterial } from "three";
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
}: DenseTerrainSurfaceProps) {
  const surfaceGeometry = useMemo(() => {
    const geometry = new BufferGeometry();

    // Create a grid-based surface from the dense points
    const { minX, maxX, minY, maxY, minZ, maxZ } = bounds;
    const stepX = (maxX - minX) / resolution;
    const stepY = (maxY - minY) / resolution;

    const positions: number[] = [];
    const indices: number[] = [];

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

    return geometry;
  }, [densePoints, bounds, resolution]);

  return (
    <mesh geometry={surfaceGeometry}>
      <meshStandardMaterial
        color={color}
        transparent={true}
        opacity={opacity}
        side={2} // DoubleSide
      />
    </mesh>
  );
}
