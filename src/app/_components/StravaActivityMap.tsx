"use client";

import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import {
  calculateBoundingBox,
  createProjection,
  projectActivities,
  type ProjectedActivity,
  type ProjectedPoint,
} from "./StravaActivityMapUtils";

interface StravaActivityMapProps {
  activities: DetailedActivityResponse[];
}

export function StravaActivityMap({ activities }: StravaActivityMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [projectedActivities, setProjectedActivities] = useState<
    ProjectedActivity[]
  >([]);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!svgRef.current) return;

    // If no activities, clear the map
    if (!activities.length) {
      setProjectedActivities([]);
      return;
    }

    console.log(
      "Activities received:",
      activities.map((a) => ({
        id: a.id,
        name: a.name,
        hasMap: !!a.map,
        hasPolyline: !!a.map?.summary_polyline,
        polylineLength: a.map?.summary_polyline?.length ?? 0,
        startLatlng: a.start_latlng,
        endLatlng: a.end_latlng,
      })),
    );

    // Calculate bounding box
    const boundingBox = calculateBoundingBox(activities);
    console.log("Bounding box:", boundingBox);

    // Create projection
    const projection = createProjection(
      activities,
      dimensions.width,
      dimensions.height,
    );

    // Project activities
    const projected = projectActivities(activities, projection);
    console.log("Projected activities:", projected.length);

    // Debug: Log some projected coordinates
    if (projected.length > 0) {
      const firstActivity = projected[0]!;
      console.log(
        "First activity projected points:",
        firstActivity.points.slice(0, 5),
      );

      // Calculate bounds of projected coordinates
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      projected.forEach((activity) => {
        activity.points.forEach((point) => {
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        });
      });
      console.log("Projected coordinate bounds:", { minX, maxX, minY, maxY });
      console.log("SVG dimensions:", dimensions);
    }

    setProjectedActivities(projected);
  }, [activities, dimensions]);

  useEffect(() => {
    const updateDimensions = () => {
      if (svgRef.current) {
        const container = svgRef.current.parentElement;
        if (container) {
          const width = container.clientWidth;
          const height = 600; // Match the fixed height of the container
          setDimensions({ width, height });
          console.log("Updated SVG dimensions:", { width, height });
        }
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  return (
    <div className="h-full w-full overflow-hidden rounded-lg bg-gray-900">
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="h-full w-full"
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {projectedActivities.map((activity) => (
          <g key={activity.id}>
            <path
              d={
                d3
                  .line<ProjectedPoint>()
                  .x((d) => d.x)
                  .y((d) => d.y)
                  .curve(d3.curveBasis)(activity.points) ?? ""
              }
              fill="none"
              stroke={activity.color}
              strokeWidth="3"
              strokeOpacity="0.8"
              filter="url(#glow)"
            />
            <path
              d={
                d3
                  .line<ProjectedPoint>()
                  .x((d) => d.x)
                  .y((d) => d.y)
                  .curve(d3.curveBasis)(activity.points) ?? ""
              }
              fill="none"
              stroke={activity.color}
              strokeWidth="1.5"
              strokeOpacity="1"
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
