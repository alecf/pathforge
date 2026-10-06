"use client";

import { Grid, Line, OrbitControls, useCursor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { GeoProjection } from "d3";
import KDBush from "kdbush";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DetailedActivity } from "strava-v3";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { densify, type DensePoint } from "~/util/densifyUtils";
import {
  calculateAltitudeBounds,
  deriveGridSpacings,
  useMapProjection,
} from "~/util/mapUtils";
import {
  buildSegmentGridIndex,
  type SegmentGridIndex,
} from "~/util/spatialIndex";
import type {
  ActivityWithStreams,
  ProjectedActivity,
} from "./ActivityMapUtils";
import { AdaptiveTerrainSurface, DenseTerrainMesh } from "./DenseTerrainMesh";

interface Activity3DMapProps {
  activities: (DetailedActivity | ActivityWithStreams)[];
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
  sampleZAt?: (x: number, y: number) => number | undefined;
  snapOffset?: number;
  hoveredId?: string | null;
  onHoverChange?: (id: string | null) => void;
  onLineClick?: (
    activity: ProjectedActivity,
    clientX: number,
    clientY: number,
  ) => void;
}

function ActivityLines({
  projectedActivities,
  altitudeBounds,
  sampleZAt,
  snapOffset = 0.2,
  hoveredId,
  onHoverChange,
  onLineClick,
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
          sampleZAt={sampleZAt}
          snapOffset={snapOffset}
          isHovered={hoveredId === String(activity.id)}
          onHoverChange={onHoverChange}
          onLineClick={onLineClick}
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
  sampleZAt?: (x: number, y: number) => number | undefined;
  snapOffset?: number;
  isHovered?: boolean;
  onHoverChange?: (id: string | null) => void;
  onLineClick?: (
    activity: ProjectedActivity,
    clientX: number,
    clientY: number,
  ) => void;
}

function ActivityLine({
  activity,
  minAltitude,
  maxAltitude,
  hasAltitudeData,
  sampleZAt,
  snapOffset = 0.2,
  isHovered = false,
  onHoverChange,
  onLineClick,
}: ActivityLineProps) {
  const { camera } = useThree();
  useCursor(isHovered);
  const points = useMemo(() => {
    return activity.points.map((point) => {
      // Optionally snap to surface height using sampler
      let normalizedAltitude = 0;
      if (sampleZAt) {
        const z = sampleZAt(point.x, point.y);
        if (typeof z === "number" && Number.isFinite(z)) {
          normalizedAltitude = z + snapOffset; // slight offset to avoid z-fighting
        }
      }
      if (
        normalizedAltitude === 0 &&
        hasAltitudeData &&
        point.altitude !== undefined
      ) {
        normalizedAltitude =
          ((point.altitude - minAltitude) / (maxAltitude - minAltitude)) * 100;
      }

      // Map projected coordinates: X -> X, Y -> Z (depth), altitude -> Y (up)
      return [point.x, normalizedAltitude, point.y] as [number, number, number];
    });
  }, [
    activity.points,
    minAltitude,
    maxAltitude,
    hasAltitudeData,
    sampleZAt,
    snapOffset,
  ]);

  // Distance-aware width: shrink when far, slightly larger when near
  const dynamicWidth = useMemo(() => {
    if (points.length < 2) return 2;
    const a = points[0];
    const b = points[Math.max(0, points.length - 1)];
    const mid = new Vector3(
      ((a?.[0] ?? 0) + (b?.[0] ?? 0)) / 2,
      ((a?.[1] ?? 0) + (b?.[1] ?? 0)) / 2,
      ((a?.[2] ?? 0) + (b?.[2] ?? 0)) / 2,
    );
    const dist = camera.position.distanceTo(mid);
    // Map distance to width: closer => ~3, far => ~0.6 (screen-space relative)
    const w = Math.max(0.6, Math.min(3, 150 / Math.max(50, dist)));
    return w;
  }, [points, camera]);

  if (points.length < 2) return null;

  return (
    <>
      {/* Visual line */}
      <Line
        points={points}
        color={activity.color}
        lineWidth={isHovered ? dynamicWidth * 2.2 : dynamicWidth}
        frustumCulled={false}
      />
      {/* Invisible, thicker hit area for easier interaction */}
      <Line
        points={points}
        color={activity.color}
        lineWidth={Math.max(dynamicWidth * 6, 10)}
        frustumCulled={false}
        transparent
        opacity={0}
        onPointerOver={(e) => {
          e.stopPropagation();
          if (onHoverChange) onHoverChange(String(activity.id));
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          if (onHoverChange) onHoverChange(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          const clientX = e.nativeEvent.clientX;
          const clientY = e.nativeEvent.clientY;
          if (onLineClick) onLineClick(activity, clientX, clientY);
        }}
      />
    </>
  );
}

interface GroundGridProps {
  projectedActivities: ProjectedActivity[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  projection: GeoProjection;
}

function GroundGrid({
  projectedActivities,
  bounds,
  projection,
}: GroundGridProps) {
  // Pick a representative point for center lat/lng (midpoint of first activity with data)
  const sampleActivity = projectedActivities.find((a) => a.points?.length);
  const midPoint = sampleActivity
    ? sampleActivity.points[Math.floor(sampleActivity.points.length / 2)]
    : undefined;

  const { cellSize: gridSpacing, sectionSize: majorGridSpacing } =
    midPoint && Number.isFinite(midPoint.lat) && Number.isFinite(midPoint.lng)
      ? deriveGridSpacings(projection, midPoint.lng, midPoint.lat, bounds)
      : { cellSize: 50, sectionSize: 200 };

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

interface DynamicClippingProps {
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
}

function DynamicClipping({
  controlsRef,
  altitudeBounds,
  centerX,
  centerZ,
  sizeX,
  sizeZ,
  autoClip,
}: DynamicClippingProps) {
  // Subscribed only so the initial clipping setup re-runs if the default
  // camera is replaced. The effect reads the camera it mutates through get(),
  // r3f's accessor for live store state outside render.
  const camera = useThree((state) => state.camera);
  const get = useThree((state) => state.get);

  // Compute static model radius from bounds
  const altitudeSpan = altitudeBounds.hasAltitudeData ? 100 : 0;
  const modelRadius = useMemo(() => {
    const diag3D = Math.sqrt(
      sizeX * sizeX + sizeZ * sizeZ + altitudeSpan * altitudeSpan,
    );
    return Math.max(1, diag3D * 0.5);
  }, [sizeX, sizeZ, altitudeSpan]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: camera is read via get() so the React Compiler allows mutating it, but the effect must re-run when it changes
  useEffect(() => {
    // Initial clipping setup based on model size
    const { camera } = get();
    const initialNear = Math.max(0.1, modelRadius / 500);
    const initialFar = Math.max(modelRadius * 20, 2000);
    camera.near = initialNear;
    camera.far = initialFar;
    camera.updateProjectionMatrix();
    if (controlsRef.current) {
      controlsRef.current.minDistance = Math.max(1, modelRadius * 0.02);
      controlsRef.current.maxDistance = Math.max(modelRadius * 20, 2000);
    }
  }, [camera, get, controlsRef, modelRadius]);

  useFrame(({ camera }) => {
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
  });

  return null;
}

export function Activity3DMap({
  activities,
  width,
  height,
}: Activity3DMapProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [densePoints, setDensePoints] = useState<DensePoint[]>([]);
  const [isDensifying, setIsDensifying] = useState(false);
  const [showDenseTerrain, setShowDenseTerrain] = useState(false);
  const [renderMode, setRenderMode] = useState<"mesh" | "surface">("mesh");
  const [snapLines, setSnapLines] = useState<boolean>(true);
  const [selectedMethod, setSelectedMethod] = useState<
    "mls" | "interpolation" | "delaunay"
  >("mls");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [card, setCard] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  // Cache terrain per selection of activities and method
  const [cacheBySelection, setCacheBySelection] = useState<
    Record<
      string,
      {
        mls?: DensePoint[];
        interpolation?: DensePoint[];
        delaunay?: DensePoint[];
      }
    >
  >({});
  const { projectedActivities, projection } = useMapProjection({
    activities,
    width,
    height,
  });

  const idToDistance = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of activities) {
      const id = a.id.toString();
      const d = a.distance;
      if (typeof d === "number") m.set(id, d);
    }
    return m;
  }, [activities]);

  // Memoized spatial indices for current visible activities
  const { segmentIndex } = useMemo(() => {
    const simple = projectedActivities.map((a) => ({
      id: a.id,
      points: a.points.map((p) => ({ x: p.x, y: p.y })),
    }));
    const sIndex: SegmentGridIndex | undefined = buildSegmentGridIndex(simple);
    return { segmentIndex: sIndex };
  }, [projectedActivities]);

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

  // Build a sampler over dense points to snap lines to the surface
  const sampleZAt = useMemo(() => {
    if (!densePoints.length) return undefined;
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
    const stepEstimate = Math.sqrt(area / Math.max(1, densePoints.length));
    const r = Math.max(5, stepEstimate * 2);
    const index = new KDBush(densePoints.length, 16, Float32Array);
    for (const p of densePoints) index.add(p.x, p.y);
    index.finish();
    return (x: number, y: number): number | undefined => {
      const ids = index.range(x - r, y - r, x + r, y + r);
      if (!ids.length) return undefined;
      let bestD2 = Infinity;
      let bestZ: number | undefined;
      for (const id of ids) {
        const s = densePoints[id]!;
        const dx = s.x - x;
        const dy = s.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestZ = s.z;
        }
      }
      return bestZ;
    };
  }, [densePoints]);

  // Key representing the current set of selected activities
  const selectionKey = useMemo(() => {
    return activities
      .map((a) => a.id?.toString?.() ?? "")
      .filter(Boolean)
      .sort((x, y) => x.localeCompare(y))
      .join("|");
  }, [activities]);

  // Synchronous first half of terrain generation. Picks the activities to
  // densify and raises the loading flag, or clears the terrain when no
  // activity has altitude data. Returns null when there is nothing to build.
  const beginDensification = (): ProjectedActivity[] | null => {
    if (projectedActivities.length === 0) return null;
    // Exclude activities without any altitude samples to avoid contaminating terrain
    const activitiesWithAltitude = projectedActivities.filter((a) =>
      a.points.some((p) => p.altitude !== undefined),
    );
    if (activitiesWithAltitude.length === 0) {
      setDensePoints([]);
      setShowDenseTerrain(false);
      return null;
    }
    setIsDensifying(true);
    return activitiesWithAltitude;
  };

  // Asynchronous second half: builds the terrain, caches it for the current
  // selection, and lowers the loading flag. Every state update sits in a
  // promise callback, so calling this from an effect updates state only
  // after the terrain is built.
  const completeDensification = (
    method: "mls" | "interpolation" | "delaunay",
    activitiesWithAltitude: ProjectedActivity[],
  ): Promise<void> => {
    const t0 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(`🚀 Starting terrain densification using ${method}...`);
    return densify(activitiesWithAltitude, {
      method,
      density: 8,
      debug: true,
    })
      .then((result) => {
        const { minAltitude, maxAltitude, hasAltitudeData } = altitudeBounds;
        const altitudeRange = Math.max(1e-6, maxAltitude - minAltitude);
        const normalizedDense = result.densePoints.map((p) => ({
          ...p,
          z: hasAltitudeData ? ((p.z - minAltitude) / altitudeRange) * 100 : 0,
        }));
        setDensePoints(normalizedDense);
        setCacheBySelection((prev) => ({
          ...prev,
          [selectionKey]: {
            ...(prev[selectionKey] ?? {}),
            [method]: normalizedDense,
          },
        }));
        setShowDenseTerrain(true);
        const t1 =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        console.log(
          `✅ Terrain generation complete: ${result.densePoints.length} points (${method}) in ${(
            t1 - t0
          ).toFixed(1)}ms`,
        );
      })
      .catch((error: unknown) => {
        console.error("❌ Densification failed:", error);
      })
      .finally(() => {
        setIsDensifying(false);
      });
  };

  const runDensification = async (
    method: "mls" | "interpolation" | "delaunay",
  ) => {
    const activitiesWithAltitude = beginDensification();
    if (activitiesWithAltitude) {
      await completeDensification(method, activitiesWithAltitude);
    }
  };

  const handleSelectMethod = async (
    method: "mls" | "interpolation" | "delaunay",
  ) => {
    setSelectedMethod(method);
    if (showDenseTerrain) {
      const cached = cacheBySelection[selectionKey]?.[method];
      if (cached && cached.length > 0) {
        setDensePoints(cached);
      } else {
        await runDensification(method);
      }
    }
  };

  // When the selected activities change while terrain is shown, switch to
  // the cached terrain for the new selection, or start regenerating it. This
  // adjusts state during render rather than in an effect, so no frame renders
  // with a stale loading flag.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  const [pendingRegeneration, setPendingRegeneration] = useState<{
    method: "mls" | "interpolation" | "delaunay";
    activitiesWithAltitude: ProjectedActivity[];
  } | null>(null);
  if (selectionKey !== prevSelectionKey) {
    setPrevSelectionKey(selectionKey);
    if (showDenseTerrain) {
      const cached = cacheBySelection[selectionKey]?.[selectedMethod];
      if (cached && cached.length > 0) {
        setDensePoints(cached);
      } else {
        // No cache for this selection+method, generate lazily
        const activitiesWithAltitude = beginDensification();
        if (activitiesWithAltitude) {
          setPendingRegeneration({
            method: selectedMethod,
            activitiesWithAltitude,
          });
        }
      }
    }
  }

  // The asynchronous half runs once the new selection has committed. Each
  // request is a new object, so the effect runs once per request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run for a new request, not when completeDensification changes
  useEffect(() => {
    if (!pendingRegeneration) return;
    void completeDensification(
      pendingRegeneration.method,
      pendingRegeneration.activitiesWithAltitude,
    );
  }, [pendingRegeneration]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-lg bg-gray-900"
    >
      {/* Help text overlay */}
      <div className="absolute top-4 left-4 z-10 rounded bg-black/50 p-2 text-xs text-white">
        <div>Mouse: Rotate view</div>
        <div>Scroll: Zoom in/out</div>
        <div>Right-click + drag: Pan</div>
        <div>Reset: Return to overview</div>
      </div>

      {/* Control buttons */}
      <div className="absolute top-4 right-4 z-10 flex flex-col items-end gap-2">
        {/* Render mode toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRenderMode("mesh")}
            disabled={isDensifying}
            className={`rounded px-3 py-1 text-xs text-white ${renderMode === "mesh" ? "bg-emerald-600" : "bg-gray-700 hover:bg-gray-600"} disabled:opacity-50`}
          >
            Mesh
          </button>
          <button
            type="button"
            onClick={() => setRenderMode("surface")}
            disabled={isDensifying}
            className={`rounded px-3 py-1 text-xs text-white ${renderMode === "surface" ? "bg-emerald-600" : "bg-gray-700 hover:bg-gray-600"} disabled:opacity-50`}
          >
            Surface
          </button>
        </div>

        {/* Densification method toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleSelectMethod("mls")}
            disabled={isDensifying}
            className={`rounded px-3 py-1 text-xs text-white ${selectedMethod === "mls" ? "bg-purple-600" : "bg-gray-700 hover:bg-gray-600"} disabled:opacity-50`}
          >
            MLS
          </button>
          <button
            type="button"
            onClick={() => void handleSelectMethod("interpolation")}
            disabled={isDensifying}
            className={`rounded px-3 py-1 text-xs text-white ${selectedMethod === "interpolation" ? "bg-purple-600" : "bg-gray-700 hover:bg-gray-600"} disabled:opacity-50`}
          >
            Interpolation
          </button>
          <button
            type="button"
            onClick={() => void handleSelectMethod("delaunay")}
            disabled={isDensifying}
            className={`rounded px-3 py-1 text-xs text-white ${selectedMethod === "delaunay" ? "bg-purple-600" : "bg-gray-700 hover:bg-gray-600"} disabled:opacity-50`}
          >
            Delaunay
          </button>
        </div>

        {/* Snap lines toggle */}
        <label className="flex items-center gap-2 text-xs text-white">
          <input
            type="checkbox"
            checked={snapLines}
            onChange={(e) => setSnapLines(e.target.checked)}
          />
          Snap lines to surface
        </label>

        {/* Show/Hide Terrain checkbox with lazy generation */}
        <label className="flex items-center gap-2 text-xs text-white">
          <input
            type="checkbox"
            checked={showDenseTerrain}
            onChange={async (e) => {
              const checked = e.target.checked;
              setShowDenseTerrain(checked);
              if (checked) {
                const cached = cacheBySelection[selectionKey]?.[selectedMethod];
                if (cached && cached.length > 0) {
                  setDensePoints(cached);
                } else {
                  await runDensification(selectedMethod);
                }
              }
            }}
          />
          {isDensifying ? "Generating terrain…" : "Show terrain"}
        </label>

        <button
          type="button"
          onClick={() => {
            if (controlsRef.current) {
              controlsRef.current.reset();
            }
          }}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
        >
          Reset View
        </button>
      </div>

      <Canvas
        camera={{
          position: [centerX, cameraDistance, centerZ],
          fov: 60,
          near: Math.max(0.1, maxSize / 1000),
          far: Math.max(maxSize * 10, 2000),
        }}
        gl={{ logarithmicDepthBuffer: true, antialias: true }}
        style={{ width, height }}
        onPointerMissed={() => setCard(null)}
      >
        {/* Lighting */}
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <pointLight position={[-10, -10, -5]} intensity={0.5} />

        {/* Ground grid on XZ plane at y=0 */}
        <GroundGrid
          projectedActivities={projectedActivities}
          bounds={bounds}
          projection={projection}
        />

        {/* Activity lines */}
        <ActivityLines
          projectedActivities={projectedActivities}
          altitudeBounds={altitudeBounds}
          sampleZAt={snapLines ? sampleZAt : undefined}
          hoveredId={hoveredId}
          onHoverChange={setHoveredId}
          onLineClick={(act, clientX, clientY) => {
            const rect = containerRef.current?.getBoundingClientRect();
            const relX = rect ? clientX - rect.left : clientX;
            const relY = rect ? clientY - rect.top : clientY;
            setCard({ id: String(act.id), x: relX, y: relY });
          }}
        />

        {/* Dense terrain */}
        {showDenseTerrain &&
          densePoints.length > 0 &&
          (renderMode === "mesh" ? (
            <DenseTerrainMesh
              densePoints={densePoints}
              pointSize={3}
              color="#4ade80"
              opacity={0.4}
            />
          ) : segmentIndex ? (
            <AdaptiveTerrainSurface
              densePoints={densePoints}
              color="#22c55e"
              opacity={0.6}
              segmentIndex={segmentIndex}
              mapBounds={{
                minX: bounds.minX,
                maxX: bounds.maxX,
                minY: bounds.minY,
                maxY: bounds.maxY,
              }}
            />
          ) : null)}

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

        {/* Dynamic clipping */}
        <DynamicClipping
          controlsRef={controlsRef}
          altitudeBounds={altitudeBounds}
          centerX={centerX}
          centerZ={centerZ}
          sizeX={sizeX}
          sizeZ={sizeZ}
          autoClip={true}
        />
      </Canvas>

      {card && (
        <div
          className="absolute z-20 max-w-xs rounded-md border bg-white p-3 text-sm shadow-md"
          style={{
            left: Math.max(8, card.x + 12),
            top: Math.max(8, card.y + 12),
          }}
        >
          <div className="font-medium text-gray-900">
            {projectedActivities.find((a) => String(a.id) === card.id)?.name ??
              "Ride"}
          </div>
          <div className="mt-1 text-gray-600">
            {(() => {
              const meters = idToDistance.get(card.id);
              if (typeof meters !== "number") return "Distance unknown";
              const km = meters / 1000;
              return `${km.toFixed(1)} km`;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
