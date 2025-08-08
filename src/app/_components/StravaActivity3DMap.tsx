"use client";

import { Grid, Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import type { PerspectiveCamera } from "three";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
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
      // Normalize altitude to 0-100 range (Y axis is up in three.js)
      let normalizedAltitude = 0;
      if (hasAltitudeData && point.altitude !== undefined) {
        normalizedAltitude =
          ((point.altitude - minAltitude) / (maxAltitude - minAltitude)) * 100;
      }

      // Map projected coordinates: X -> X, Y -> Z (depth), altitude -> Y (up)
      return [point.x, normalizedAltitude, point.y] as [number, number, number];
    });
  }, [activity.points, minAltitude, maxAltitude, hasAltitudeData]);

  if (points.length < 2) return null;

  return (
    <Line
      points={points}
      color={activity.color}
      lineWidth={3}
      frustumCulled={false}
    />
  );
}

interface GroundGridProps {
  projectedActivities: ProjectedActivity[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

function GroundGrid({
  projectedActivities: _projectedActivities,
  bounds,
}: GroundGridProps) {
  // Grid spacing in projected coordinate units
  // Since coordinates are projected to fit the view, we'll use a reasonable spacing
  const gridSpacing = 50; // Minor grid lines
  const majorGridSpacing = 200; // Major grid lines

  return (
    <Grid
      // XZ plane: width along X, height along Z; Y stays 0
      args={[bounds.maxX - bounds.minX, bounds.maxY - bounds.minY]}
      position={[
        (bounds.maxX + bounds.minX) / 2,
        0,
        (bounds.maxY + bounds.minY) / 2,
      ]}
      cellSize={gridSpacing}
      cellThickness={0.5}
      cellColor="#444444"
      sectionSize={majorGridSpacing}
      sectionThickness={1}
      sectionColor="#666666"
      fadeDistance={2000}
      fadeStrength={0.5}
      followCamera={false}
      infiniteGrid={false}
    />
  );
}

interface DynamicClippingAndHudProps {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  altitudeBounds: {
    minAltitude: number;
    maxAltitude: number;
    hasAltitudeData: boolean;
  };
  centerX: number;
  centerZ: number;
  sizeX: number;
  sizeZ: number;
  autoClip: boolean;
  setAutoClip: (value: boolean) => void;
}

function DynamicClippingAndHud({
  controlsRef,
  altitudeBounds,
  centerX,
  centerZ,
  sizeX,
  sizeZ,
  autoClip,
  setAutoClip,
}: DynamicClippingAndHudProps) {
  const { camera } = useThree();
  const [metrics, setMetrics] = useState({
    camPos: [0, 0, 0] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    fov: 60,
    near: 0.1,
    far: 10000,
    distance: 0,
    radius: 0,
  });

  // Compute static model radius from bounds
  const altitudeSpan = altitudeBounds.hasAltitudeData ? 100 : 0;
  const modelRadius = useMemo(() => {
    const diag3D = Math.sqrt(
      sizeX * sizeX + sizeZ * sizeZ + altitudeSpan * altitudeSpan,
    );
    return Math.max(1, diag3D * 0.5);
  }, [sizeX, sizeZ, altitudeSpan]);

  useEffect(() => {
    // Initial clipping setup based on model size
    if (!camera) return;
    const initialNear = Math.max(0.1, modelRadius / 500);
    const initialFar = Math.max(modelRadius * 20, 2000);
    camera.near = initialNear;
    camera.far = initialFar;
    camera.updateProjectionMatrix();
    if (controlsRef.current) {
      controlsRef.current.minDistance = Math.max(1, modelRadius * 0.02);
      controlsRef.current.maxDistance = Math.max(modelRadius * 20, 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, modelRadius]);

  useFrame(() => {
    const target =
      controlsRef.current?.target ?? new Vector3(centerX, 0, centerZ);
    const camPos = camera.position;
    const distance = camPos.distanceTo(target);

    if (autoClip) {
      const desiredNear = Math.max(0.1, distance / 2000);
      const desiredFar = Math.max(distance * 6, modelRadius * 20, 2000);
      if (Math.abs(camera.near - desiredNear) / camera.near > 0.2) {
        camera.near = desiredNear;
        camera.updateProjectionMatrix();
      }
      if (Math.abs(camera.far - desiredFar) / camera.far > 0.2) {
        camera.far = desiredFar;
        camera.updateProjectionMatrix();
      }
      if (controlsRef.current) {
        controlsRef.current.minDistance = Math.max(1, modelRadius * 0.02);
        controlsRef.current.maxDistance = Math.max(
          modelRadius * 20,
          distance * 1.2,
        );
      }
    }

    setMetrics({
      camPos: [camPos.x, camPos.y, camPos.z],
      target: [target.x, target.y, target.z],
      fov: (camera as PerspectiveCamera).fov ?? 60,
      near: camera.near,
      far: camera.far,
      distance,
      radius: modelRadius,
    });
  });

  return (
    <Html transform={false} prepend>
      <div
        className="pointer-events-auto absolute bottom-4 left-4 z-20 max-w-[90vw] rounded bg-black/60 p-2 text-xs text-white"
        style={{ backdropFilter: "blur(4px)" }}
      >
        <div className="mb-1 font-semibold">3D Debug</div>
        <div>
          Camera pos: [{metrics.camPos.map((n) => n.toFixed(1)).join(", ")}]
        </div>
        <div>
          Target: [{metrics.target.map((n) => n.toFixed(1)).join(", ")}]
        </div>
        <div>
          fov: {metrics.fov.toFixed(1)} | near: {metrics.near.toFixed(2)} | far:{" "}
          {metrics.far.toFixed(0)}
        </div>
        <div>
          distance: {metrics.distance.toFixed(1)} | radius:{" "}
          {metrics.radius.toFixed(1)}
        </div>
        <div>
          bounds size X/Z: {sizeX.toFixed(1)} / {sizeZ.toFixed(1)} | center X/Z:{" "}
          {centerX.toFixed(1)} / {centerZ.toFixed(1)}
        </div>
        <button
          className="mt-1 rounded bg-blue-600 px-2 py-0.5 text-[10px] hover:bg-blue-700"
          onClick={(e) => {
            e.stopPropagation();
            setAutoClip(!autoClip);
          }}
        >
          Auto clip: {autoClip ? "on" : "off"}
        </button>
      </div>
    </Html>
  );
}

export function StravaActivity3DMap({
  activities,
  width,
  height,
}: StravaActivity3DMapProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const [autoClip, setAutoClip] = useState(true);
  const { projectedActivities } = useMapProjection({
    activities,
    width,
    height,
  });

  const altitudeBounds = useMemo(() => {
    return calculateAltitudeBounds(activities);
  }, [activities]);

  // Calculate bounds for camera positioning
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

  // Calculate center and size for camera positioning (Y is up, use bounds Y as Z depth)
  const centerX = (bounds.maxX + bounds.minX) / 2;
  const centerZ = (bounds.maxY + bounds.minY) / 2;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxY - bounds.minY;
  const maxSize = Math.max(sizeX, sizeZ);
  const cameraDistance = Math.max(maxSize * 3, 300); // Position camera further out, with minimum distance

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg bg-gray-900">
      {/* Help text overlay */}
      <div className="absolute top-4 left-4 z-10 rounded bg-black/50 p-2 text-xs text-white">
        <div>Mouse: Rotate view</div>
        <div>Scroll: Zoom in/out</div>
        <div>Right-click + drag: Pan</div>
        <div>Reset: Return to overview</div>
      </div>

      {/* Reset view button */}
      <button
        onClick={() => {
          if (controlsRef.current) {
            controlsRef.current.reset();
          }
        }}
        className="absolute top-4 right-4 z-10 rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
      >
        Reset View
      </button>

      <Canvas
        camera={{
          position: [centerX, cameraDistance, centerZ],
          fov: 60,
          near: Math.max(0.1, maxSize / 1000),
          far: Math.max(maxSize * 10, 2000),
        }}
        gl={{ logarithmicDepthBuffer: true, antialias: true }}
        style={{ width, height }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <pointLight position={[-10, -10, -5]} intensity={0.5} />

        {/* Ground grid on XZ plane at y=0 */}
        <GroundGrid projectedActivities={projectedActivities} bounds={bounds} />

        {/* Activity lines */}
        <ActivityLines
          projectedActivities={projectedActivities}
          altitudeBounds={altitudeBounds}
        />

        {/* Controls */}
        <OrbitControls
          ref={controlsRef}
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={20}
          maxDistance={5000}
          maxPolarAngle={Math.PI / 2} // Prevent going below ground
          dampingFactor={0.05}
          enableDamping={true}
          target={[centerX, 0, centerZ]} // Look at the center on the ground plane
        />

        {/* Dynamic clipping + on-screen HUD */}
        <DynamicClippingAndHud
          controlsRef={controlsRef}
          altitudeBounds={altitudeBounds}
          centerX={centerX}
          centerZ={centerZ}
          sizeX={sizeX}
          sizeZ={sizeZ}
          autoClip={autoClip}
          setAutoClip={setAutoClip}
        />
      </Canvas>
    </div>
  );
}
