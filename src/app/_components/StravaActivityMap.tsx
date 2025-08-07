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
  const [viewBox, setViewBox] = useState("0 0 800 600");
  const [scaleFactor, setScaleFactor] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);

  useEffect(() => {
    if (!activities.length || !svgRef.current) return;

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

    // Test with a simple activity first
    const firstActivity = activities.find((a) => a.map?.summary_polyline);
    if (firstActivity?.map?.summary_polyline) {
      console.log(
        "Testing first activity polyline:",
        firstActivity.map.summary_polyline.substring(0, 100),
      );
    }

    // Calculate bounding box
    const boundingBox = calculateBoundingBox(activities);
    console.log("Bounding box:", boundingBox);

    // Create projection
    const projection = createProjection(
      boundingBox,
      dimensions.width,
      dimensions.height,
    );

    // Project activities
    const projected = projectActivities(activities, projection);
    console.log("projected ", projected, " from ", activities);
    setProjectedActivities(projected);

    // Calculate viewBox from projected coordinates
    if (projected.length > 0) {
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

      // Calculate scale factor to make the route more visible
      const routeWidth = maxX - minX;
      const routeHeight = maxY - minY;
      const svgWidth = dimensions.width;
      const svgHeight = dimensions.height;

      // Calculate scale to fit the route in 80% of the SVG area
      const scaleX = (svgWidth * 0.8) / Math.max(routeWidth, 1);
      const scaleY = (svgHeight * 0.8) / Math.max(routeHeight, 1);
      const newScaleFactor = Math.min(scaleX, scaleY, 100); // Increased cap to 100x for very small routes

      // Calculate center of the route
      const routeCenterX = (minX + maxX) / 2;
      const routeCenterY = (minY + maxY) / 2;
      const svgCenterX = svgWidth / 2;
      const svgCenterY = svgHeight / 2;

      console.log("Route dimensions:", routeWidth, "x", routeHeight);
      console.log("SVG dimensions:", svgWidth, "x", svgHeight);
      console.log(
        "Scale factors - X:",
        scaleX,
        "Y:",
        scaleY,
        "Final:",
        newScaleFactor,
      );
      console.log(
        "Route center:",
        [routeCenterX, routeCenterY],
        "SVG center:",
        [svgCenterX, svgCenterY],
      );

      // Calculate translation to center the route
      const newTranslateX = svgCenterX - routeCenterX * newScaleFactor;
      const newTranslateY = svgCenterY - routeCenterY * newScaleFactor;

      console.log("Translation:", [newTranslateX, newTranslateY]);

      setScaleFactor(newScaleFactor);
      setTranslateX(newTranslateX);
      setTranslateY(newTranslateY);
    }
  }, [activities, dimensions]);

  useEffect(() => {
    const updateDimensions = () => {
      if (svgRef.current) {
        const container = svgRef.current.parentElement;
        if (container) {
          setDimensions({
            width: container.clientWidth,
            height: Math.max(400, container.clientHeight),
          });
        }
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  return (
    <div className="h-[600px] w-full overflow-hidden rounded-lg bg-gray-900">
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
          <g
            key={activity.id}
            transform={`translate(${translateX}, ${translateY}) scale(${scaleFactor})`}
          >
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
