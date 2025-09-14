"use client";

import * as d3 from "d3";
import { useEffect, useRef, useState } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import { useMapProjection } from "~/util/mapUtils";
import {
  type ActivityWithStreams,
  type ProjectedPoint,
} from "./ActivityMapUtils";

interface ActivityMapProps {
  activities: (DetailedActivityResponse | ActivityWithStreams)[];
  width?: number;
  height?: number;
}

export function ActivityMap({ activities, width, height }: ActivityMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({
    width: width ?? 800,
    height: height ?? 600,
  });

  // Use shared projection logic
  const { projectedActivities } = useMapProjection({
    activities,
    width: dimensions.width,
    height: dimensions.height,
  });

  useEffect(() => {
    if (!svgRef.current) return;

    // If no activities, clear the map
    if (!activities.length) {
      return;
    }

    console.log(
      "Activities received:",
      activities.map((a) => ({
        id: a.id,
        name: a.name,
        hasMap: !!a.map,
        hasPolyline: !!(a.map?.polyline ?? a.map?.summary_polyline),
        polylineLength:
          (a.map?.polyline ?? a.map?.summary_polyline)?.length ?? 0,
        startLatlng: a.start_latlng,
        endLatlng: a.end_latlng,
      })),
    );

    // Debug: Log some projected coordinates
    if (projectedActivities.length > 0) {
      // Calculate bounds of projected coordinates
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      projectedActivities.forEach((activity) => {
        activity.points.forEach((point) => {
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        });
      });
    }
  }, [activities, projectedActivities]);

  useEffect(() => {
    const updateDimensions = () => {
      if (svgRef.current) {
        const container = svgRef.current.parentElement;
        if (container) {
          const width = container.clientWidth;
          const height = container.clientHeight;
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
