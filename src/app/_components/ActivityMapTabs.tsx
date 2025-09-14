"use client";

import { useEffect, useRef, useState } from "react";
import { type DetailedActivityResponse } from "strava-v3";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Activity3DMap } from "./Activity3DMap";
import { ActivityMap } from "./ActivityMap";
import { type ActivityWithStreams } from "./ActivityMapUtils";

interface ActivityMapTabsProps {
  activities: (DetailedActivityResponse | ActivityWithStreams)[];
}

export function ActivityMapTabs({ activities }: ActivityMapTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;
        setDimensions({ width, height });
        console.log("Updated container dimensions:", { width, height });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      <Tabs defaultValue="2d" className="h-full w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="2d">2D Map</TabsTrigger>
          <TabsTrigger value="3d">3D Map</TabsTrigger>
        </TabsList>

        <TabsContent value="2d" className="h-full w-full">
          <ActivityMap
            activities={activities}
            width={dimensions.width}
            height={dimensions.height}
          />
        </TabsContent>

        <TabsContent value="3d" className="h-full w-full">
          <Activity3DMap
            activities={activities}
            width={dimensions.width}
            height={dimensions.height}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
