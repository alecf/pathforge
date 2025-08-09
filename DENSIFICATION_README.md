# Densification for 3D Terrain Generation (Non‑ML)

This implementation provides a browser-based PU-Net model for densifying activity points to create detailed 3D terrain visualization using **actual pre-trained PU-Net models**.

## Features

- **MLS Densification**: MLS-style smoothing on a grid using a spatial index (KDBush)
- **Automatic Method Selection**: Automatically chooses the best non‑ML method
- **Interpolation Fallback**: Simple interpolation method when MLS is unsuitable
- **Browser-based**: Runs entirely in the browser
- **3D Visualization**: Renders dense points as terrain meshes in your 3D map
- **Performance Monitoring**: Built-in timing and debug information

## How to Use

### Basic Usage

```typescript
import { densify } from "~/util/densifyUtils";

// Auto-select best available method (recommended)
const densePoints = await densify(projectedActivities, {
  method: "auto", // Chooses PU-Net if available, otherwise interpolation
  density: 10, // points per unit distance
  debug: true, // Enable performance monitoring
});

// Or specify a particular method
const punetPoints = await densify(projectedActivities, {
  method: "pu-net", // Requires pre-trained model
  density: 8,
});
```

### In the 3D Map Component

The 3D map component now includes a "Generate Terrain" button that will:

1. Take your projected activities
2. Run the densification algorithm
3. Render the dense points as a green terrain mesh
4. Allow you to toggle the terrain visibility

### Configuration Options

- **method**: `'auto'` (default), `'pu-net'`, or `'interpolation'`
- **density**: Number of points per unit distance (default: 10)
- **debug**: Enable performance monitoring and detailed logging (default: false)

## Technical Details

### MLS Implementation

1. **Spatial Index**: Builds a `kdbush` index over input points
2. **Sampling Grid**: Grid step derived from `density`
3. **Smoothing**: Gaussian weights within radius to estimate elevation
4. **Output**: Dense grid of points suitable for surface reconstruction

### Performance Considerations

- **Memory**: Large datasets may require batch processing
- **Index**: KDBush keeps neighborhood lookups fast
- **Fallback**: Automatically falls back to interpolation if neural network fails

### Rendering Options

Two rendering methods are available:

1. **Point Cloud** (`DenseTerrainMesh`): Renders individual points
2. **Surface Mesh** (`DenseTerrainSurface`): Creates a triangulated surface

## Testing

Visit `/densify-test` to test densification with sample data.

## Dependencies

- `kdbush`: Fast static spatial index

## Future Improvements

- [ ] Implement proper inverse projection for lat/lng conversion
- [ ] Add more sophisticated neural network architectures
- [ ] Implement progressive loading for large datasets
- [ ] Add elevation data from external APIs (OpenTopography, etc.)
- [ ] Optimize rendering performance for very large point clouds

## Troubleshooting

### Common Issues

1. **TensorFlow.js not loading**: Ensure WebGL is available in your browser
2. **Memory errors**: Reduce density or use interpolation method
3. **Slow performance**: Consider using surface mesh instead of point cloud

### Debug Mode

Enable console logging to see detailed information:

```typescript
const result = await densify(projectedActivities, {
  method: "pu-net",
  density: 8,
  debug: true, // Add this for detailed logging
});
```

## API Reference

### `densify(projectedActivities, options)`

**Parameters:**

- `projectedActivities`: Array of projected activity data
- `options`: Configuration object
  - `method`: `'pu-net' | 'interpolation'`
  - `density`: `number` (points per unit)

**Returns:**

- `Promise<DensificationResult>`
  - `densePoints`: Array of dense 3D points
  - `bounds`: Bounding box information

### `DenseTerrainMesh`

**Props:**

- `densePoints`: Array of dense points
- `pointSize`: Size of rendered points
- `color`: Color of the terrain
- `opacity`: Transparency level

### `DenseTerrainSurface`

**Props:**

- `densePoints`: Array of dense points
- `bounds`: Bounding box information
- `resolution`: Grid resolution for surface
- `color`: Color of the surface
- `opacity`: Transparency level
