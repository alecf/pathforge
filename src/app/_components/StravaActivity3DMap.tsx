"use client";

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import { calculateAltitudeBounds, useMapProjection } from "~/util/mapUtils";
import {
  type ActivityWithStreams,
  type ProjectedActivity,
} from "./StravaActivityMapUtils";

interface StravaActivity3DMapProps {
  activities: (DetailedActivityResponse | ActivityWithStreams)[];
  width: number;
  height: number;
}

interface ActivityLinesProps {
  projectedActivities: ProjectedActivity[];
  altitudeBounds: {
    minAltitude: number;
    maxAltitude: number;
    hasAltitudeData: boolean;
  };
}

function ActivityLines({
  projectedActivities,
  altitudeBounds,
}: ActivityLinesProps) {
  const { minAltitude, maxAltitude, hasAltitudeData } = altitudeBounds;

  return (
    <>
      {projectedActivities.map((activity) => (
        <ActivityLine
          key={activity.id}
          activity={activity}
          minAltitude={minAltitude}
          maxAltitude={maxAltitude}
          hasAltitudeData={hasAltitudeData}
        />
      ))}
    </>
  );
}

interface ActivityLineProps {
  activity: ProjectedActivity;
  minAltitude: number;
  maxAltitude: number;
  hasAltitudeData: boolean;
}

function ActivityLine({
  activity,
  minAltitude,
  maxAltitude,
  hasAltitudeData,
}: ActivityLineProps) {
  const points = useMemo(() => {
    return activity.points.map((point) => {
      // Normalize altitude to 0-100 range
      let normalizedZ = 0;
      if (hasAltitudeData && point.altitude !== undefined) {
        normalizedZ =
          ((point.altitude - minAltitude) / (maxAltitude - minAltitude)) * 100;
      }

      return [point.x, point.y, normalizedZ] as [number, number, number];
    });
  }, [activity.points, minAltitude, maxAltitude, hasAltitudeData]);

  if (points.length < 2) return null;

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[new Float32Array(points.flat()), 3]}
          count={points.length}
        />
      </bufferGeometry>
      <lineBasicMaterial color={activity.color} linewidth={3} />
    </line>
  );
}

interface GroundGridProps {
  projectedActivities: ProjectedActivity[];
}

function GroundGrid({ projectedActivities }: GroundGridProps) {
  // Calculate bounding box of projected activities
  const bounds = useMemo(() => {
    if (projectedActivities.length === 0) {
      return { minX: -100, maxX: 100, minY: -100, maxY: 100 };
    }

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;

    projectedActivities.forEach((activity) => {
      activity.points.forEach((point) => {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      });
    });

    // Add some padding
    const padding = 50;
    return {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding,
    };
  }, [projectedActivities]);

  // Grid spacing in projected coordinate units
  // Since coordinates are projected to fit the view, we'll use a reasonable spacing
  const gridSpacing = 50; // Minor grid lines
  const majorGridSpacing = 200; // Major grid lines

  return (
    <Grid
      args={[bounds.maxX - bounds.minX, bounds.maxY - bounds.minY]}
      position={[
        (bounds.maxX + bounds.minX) / 2,
        (bounds.maxY + bounds.minY) / 2,
        0,
      ]}
      cellSize={gridSpacing}
      cellThickness={0.5}
      cellColor="#444444"
      sectionSize={majorGridSpacing}
      sectionThickness={1}
      sectionColor="#666666"
      fadeDistance={200}
      fadeStrength={1}
      followCamera={false}
      infiniteGrid={false}
    />
  );
}

export function StravaActivity3DMap({
  activities,
  width,
  height,
}: StravaActivity3DMapProps) {
  const { projectedActivities } = useMapProjection({
    activities,
    width,
    height,
  });

  const altitudeBounds = useMemo(() => {
    return calculateAltitudeBounds(activities);
  }, [activities]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-gray-900">
      {/* Help text overlay */}
      <div className="absolute top-4 left-4 z-10 rounded bg-black/50 p-2 text-xs text-white">
        <div>Mouse: Rotate view</div>
        <div>Scroll: Zoom in/out</div>
        <div>Right-click + drag: Pan</div>
      </div>

      <Canvas
        camera={{
          position: [0, 0, 200],
          fov: 60,
          near: 0.1,
          far: 1000,
        }}
        style={{ width, height }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <pointLight position={[-10, -10, -5]} intensity={0.5} />

        {/* Ground grid */}
        <GroundGrid projectedActivities={projectedActivities} />

        {/* Activity lines */}
        <ActivityLines
          projectedActivities={projectedActivities}
          altitudeBounds={altitudeBounds}
        />

        {/* Controls */}
        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={50}
          maxDistance={500}
          maxPolarAngle={Math.PI / 2} // Prevent going below ground
          dampingFactor={0.05}
          enableDamping={true}
        />
      </Canvas>
    </div>
  );
}
