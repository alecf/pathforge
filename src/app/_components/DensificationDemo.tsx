"use client";

import { useEffect, useState } from "react";
import {
  densify,
  getAvailableMethods,
  type DensePoint,
} from "~/util/densifyUtils";
import type { ProjectedActivity } from "./ActivityMapUtils";

// Sample projected activities for testing
const sampleProjectedActivities: ProjectedActivity[] = [
  {
    id: "1",
    name: "Sample Activity 1",
    color: "#ff0000",
    points: [
      { x: 0, y: 0, z: 100, lat: 0, lng: 0, altitude: 100 },
      { x: 10, y: 5, z: 120, lat: 0, lng: 0, altitude: 120 },
      { x: 20, y: 10, z: 110, lat: 0, lng: 0, altitude: 110 },
      { x: 30, y: 15, z: 130, lat: 0, lng: 0, altitude: 130 },
      { x: 40, y: 20, z: 125, lat: 0, lng: 0, altitude: 125 },
    ],
  },
  {
    id: "2",
    name: "Sample Activity 2",
    color: "#00ff00",
    points: [
      { x: 5, y: 5, z: 105, lat: 0, lng: 0, altitude: 105 },
      { x: 15, y: 10, z: 115, lat: 0, lng: 0, altitude: 115 },
      { x: 25, y: 15, z: 125, lat: 0, lng: 0, altitude: 125 },
      { x: 35, y: 20, z: 135, lat: 0, lng: 0, altitude: 135 },
      { x: 45, y: 25, z: 145, lat: 0, lng: 0, altitude: 145 },
    ],
  },
];

export function DensificationDemo() {
  const [densePoints, setDensePoints] = useState<DensePoint[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<string>("");
  const [availableMethods, setAvailableMethods] = useState<
    Array<{ method: string; name: string; description: string }>
  >([]);

  useEffect(() => {
    // Check what methods are available
    const checkMethods = async () => {
      const methods = await getAvailableMethods();
      setAvailableMethods(methods);
    };
    void checkMethods();
  }, []);

  const handleTestMethod = async (method: "mls" | "interpolation" | "auto") => {
    setIsProcessing(true);
    setResult("");

    try {
      console.log(`Starting ${method} densification...`);
      const startTime = performance.now();

      const densificationResult = await densify(sampleProjectedActivities, {
        method,
        density: 5,
        debug: true,
      });

      const endTime = performance.now();
      const processingTime = ((endTime - startTime) / 1000).toFixed(2);

      setDensePoints(densificationResult.densePoints);
      setResult(
        `✅ Success! Generated ${densificationResult.densePoints.length} dense points using ${method}.\n` +
          `Processing time: ${processingTime}s\n` +
          `Bounds: X(${densificationResult.bounds.minX.toFixed(1)}-${densificationResult.bounds.maxX.toFixed(1)}), ` +
          `Y(${densificationResult.bounds.minY.toFixed(1)}-${densificationResult.bounds.maxY.toFixed(1)}), ` +
          `Z(${densificationResult.bounds.minZ.toFixed(1)}-${densificationResult.bounds.maxZ.toFixed(1)})`,
      );

      console.log("Densification result:", densificationResult);
    } catch (error) {
      console.error("Densification failed:", error);
      setResult(
        `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-xl font-bold">Densification Demo</h2>

      {/* Status Information */}
      <div className="rounded bg-blue-50 p-3">
        <h3 className="mb-2 font-semibold">System Status</h3>
        <div className="space-y-1 text-sm">
          <div>📊 Available Methods: {availableMethods.length}</div>
        </div>
      </div>

      {/* Available Methods */}
      <div className="rounded bg-gray-50 p-3">
        <h3 className="mb-2 font-semibold">Available Methods</h3>
        <div className="space-y-2">
          {availableMethods.map((method) => (
            <div key={method.method} className="text-sm">
              <span className="font-medium">{method.name}</span>:{" "}
              {method.description}
            </div>
          ))}
        </div>
      </div>

      {/* Test Buttons */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <button
            onClick={() => handleTestMethod("auto")}
            disabled={isProcessing}
            className="rounded bg-purple-500 px-4 py-2 text-white hover:bg-purple-600 disabled:opacity-50"
          >
            {isProcessing ? "Processing..." : "Test Auto (Recommended)"}
          </button>

          <button
            onClick={() => handleTestMethod("mls")}
            disabled={isProcessing}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {isProcessing ? "Processing..." : "Test MLS"}
          </button>

          <button
            onClick={() => handleTestMethod("interpolation")}
            disabled={isProcessing}
            className="rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600 disabled:opacity-50"
          >
            {isProcessing ? "Processing..." : "Test Interpolation"}
          </button>
        </div>

        {/* PU-Net notice removed since ML is no longer used */}
      </div>

      {result && (
        <div className="rounded bg-gray-100 p-4">
          <h3 className="mb-2 font-semibold">Result:</h3>
          <pre className="text-sm whitespace-pre-wrap">{result}</pre>
        </div>
      )}

      {densePoints.length > 0 && (
        <div className="rounded bg-gray-100 p-4">
          <h3 className="mb-2 font-semibold">
            Sample Dense Points (first 10):
          </h3>
          <div className="space-y-1 text-sm">
            {densePoints.slice(0, 10).map((point, index) => (
              <div key={index}>
                Point {index + 1}: x={point.x.toFixed(2)}, y=
                {point.y.toFixed(2)}, z={point.z.toFixed(2)}
              </div>
            ))}
            {densePoints.length > 10 && (
              <div className="text-gray-500">
                ... and {densePoints.length - 10} more points
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
