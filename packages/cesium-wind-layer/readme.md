# Cube Cesium Wind Layer

[![npm version](https://img.shields.io/npm/v/cube-cesium-wind-layer.svg)](https://www.npmjs.com/package/cube-cesium-wind-layer)
[![license](https://img.shields.io/npm/l/cube-cesium-wind-layer.svg)](https://github.com/NOC-OI/cesium-wind-layer/blob/main/LICENSE)

A GPU-accelerated Cesium particle layer for visualizing two-dimensional wind fields and three-dimensional velocity cubes.

> `cube-cesium-wind-layer` is the npm package for this NOC-OI fork of the original [hongfaqiu/cesium-wind-layer](https://github.com/hongfaqiu/cesium-wind-layer). The original project provides the core GPU particle renderer and Cesium integration. This fork adds velocity-cube rendering, coordinate-orientation metadata, depth/elevation placement, per-level particle density, camera-scale controls, and packaging fixes. These additions are maintained by NOC-OI and should not be understood as upstream features. This repository preserves its MIT license and attribution requirements.

[NOC-OI live demo](https://noc-oi.github.io/cesium-wind-layer/) | [Chinese documentation](./readme.zh-CN.md) | [Upstream project](https://github.com/hongfaqiu/cesium-wind-layer) | [Upstream live demo](https://cesium-wind-layer.opendde.com/)

| Wind Layer | Terrain Occlusion |
|---|---|
| ![Wind Layer Demo](https://github.com/NOC-OI/cesium-wind-layer/blob/main/pictures/wind.gif?raw=true) | ![Terrain Occlusion Demo](https://github.com/NOC-OI/cesium-wind-layer/blob/main/pictures/terrain.gif?raw=true) |

## Features

- Real-time, GPU-accelerated particle visualization
- Two-dimensional wind fields and complete three-dimensional velocity cubes
- Actual elevation/depth coordinates with optional vertical exaggeration
- Semantic latitude and elevation orientation metadata
- Approximately constant particle density per enabled elevation level
- Configurable particle appearance, animation, visibility, and camera scaling
- Terrain occlusion

## Installation

```bash
pnpm add cube-cesium-wind-layer
```

Cesium is a peer dependency. The application should install and bundle one compatible Cesium runtime.

## Two-dimensional data

The U and V arrays must each contain `width * height` values in row-major order: `[latitude][longitude]`. Use `latIsAscending` to describe whether row indices progress from south to north.

```typescript
import { Viewer } from 'cesium';
import { WindLayer, type WindData } from 'cube-cesium-wind-layer';

const viewer = new Viewer('cesiumContainer');

const windData: WindData = {
  u: { array: uValues },
  v: { array: vValues },
  width,
  height,
  latIsAscending: true,
  bounds: { west: -50, south: -20, east: 10, north: 20 }
};

const windLayer = new WindLayer(viewer, windData, {
  particlesTextureSize: 100,
  particleHeight: 1000,
  lineWidth: { min: 1, max: 2 },
  lineLength: { min: 20, max: 100 },
  speedFactor: 1,
  colors: ['white']
});
```

If `speed` is omitted, the layer calculates it from U and V.

## Velocity cubes

A single `WindLayer` can render a complete velocity cube. U and V use elevation-major, row-major layout:

```text
[elevation][latitude][longitude]
index = elevationIndex * width * height + latitudeIndex * width + longitudeIndex
```

Each component array must contain exactly `width * height * depth` values. The `elevations` array must contain `depth` finite coordinate values.

```typescript
import { WindLayer, type WindCubeData } from 'cube-cesium-wind-layer';

const windCube: WindCubeData = {
  u: { array: uCube },
  v: { array: vCube },
  width,
  height,
  depth: elevations.length,
  elevations,
  latIsAscending: true,
  elevationIsAscending: elevations[0] < elevations[elevations.length - 1],
  bounds: { west: -50, south: -20, east: 10, north: 20 }
};

const windLayer = new WindLayer(viewer, windCube, {
  particlesTextureSize: 100,
  verticalExaggeration: 1000,
  belowSeaLevel: true,
  elevationStep: 1
});
```

The cube is packed into GPU texture atlases and rendered by one particle system. Particles are distributed deterministically among enabled levels so that small particle textures do not accidentally leave levels empty.

### Elevation placement

- With `belowSeaLevel: false`, height is `elevation * verticalExaggeration`.
- With `belowSeaLevel: true`, height is `-(maximumElevation - elevation) * verticalExaggeration`. This places the largest coordinate at sea level and the remaining coordinates below it.
- `elevationIsAscending` describes the order of the cube axis. When omitted, it is inferred from the first and last elevation values.
- `elevationStep` renders every nth level. It must be a positive integer.

The supplied coordinate values determine spacing between rendered levels; levels are not forced to equal spacing.

### Particle density

For a cube, `particlesTextureSize` is the baseline texture dimension for one enabled elevation. The effective texture dimension is:

```text
ceil(particlesTextureSize * sqrt(ceil(depth / elevationStep)))
```

This keeps the approximate particle count per enabled level constant. The resulting texture must not exceed the WebGL context's maximum texture size; the constructor and relevant updates throw a `RangeError` when it does.

## Coordinate orientation

`latIsAscending` describes the data, whereas `flipY` describes an internal texture operation. Prefer `latIsAscending` for both 2D fields and cubes:

- `true`: latitude rows run south to north.
- `false`: latitude rows run north to south.
- omitted: legacy defaults apply.

`flipY` remains available only for backward compatibility with 2D integrations. It is deprecated and ignored for cubes, where orientation is derived from `latIsAscending`. `elevationIsAscending` is independent of latitude orientation and describes only the ordering of cube levels.

## API reference

### Data types

```typescript
interface WindData {
  u: { array: Float32Array; min?: number; max?: number };
  v: { array: Float32Array; min?: number; max?: number };
  speed?: { array: Float32Array; min?: number; max?: number };
  width: number;
  height: number;
  bounds: { west: number; south: number; east: number; north: number };
  latIsAscending?: boolean;
}

interface WindCubeData extends WindData {
  depth: number;
  elevations: ArrayLike<number>;
  elevationIsAscending?: boolean;
}
```

### Options

| Option | Default | Description |
|---|---:|---|
| `particlesTextureSize` | `100` | 2D texture dimension, or per-level baseline for a cube. Approximate particle count is the effective size squared. |
| `particleHeight` | `1000` | Height in metres for a 2D field. |
| `verticalExaggeration` | `1` | Multiplier applied to cube elevation coordinates. Must be greater than zero. |
| `belowSeaLevel` | `false` | Interpret cube coordinates as levels extending downwards from the maximum coordinate. |
| `elevationStep` | `1` | Populate every nth cube level. Must be a positive integer. |
| `lineWidth` | `{ min: 1, max: 2 }` | Particle trail width range in pixels. |
| `lineLength` | `{ min: 20, max: 100 }` | Particle trail length range. |
| `speedFactor` | `1` | Particle movement speed multiplier. |
| `dropRate` | `0.003` | Base probability of resetting a particle. |
| `dropRateBump` | `0.01` | Additional reset probability based on velocity. |
| `colors` | `['white']` | Particle color ramp. |
| `domain` | `undefined` | Optional `{ min, max }` speed rendering domain. |
| `displayRange` | `undefined` | Optional `{ min, max }` visible speed range. |
| `useViewerBounds` | `false` | Generate particles within the current viewer bounds. |
| `minVisibleRatio` | `0.6` | Minimum camera-driven scale for width, trail length, and speed; use `1` to disable scaling. |
| `dynamic` | `true` | Enable particle animation. |
| `flipY` | `false` | Deprecated 2D-only texture orientation override. |

### Methods

| Method | Description |
|---|---|
| `add()` | Add the particle primitives to the scene. |
| `remove()` | Remove the particle primitives from the scene without destroying the layer. |
| `show: boolean` | Get or set visibility. |
| `updateWindData(data)` | Replace the current 2D field or complete cube and rebuild the required GPU resources. |
| `updateOptions(options)` | Merge new options and rebuild resources affected by density or elevation placement changes. |
| `getDataAtLonLat(lon, lat, elevationIndex?)` | Interpolate U, V, and speed at a position. The elevation index defaults to `0` and is validated against cube depth. |
| `zoomTo(duration?)` | Fit the camera to the horizontal data extent. |
| `isDestroyed()` | Report whether the layer has been destroyed. |
| `destroy()` | Remove primitives, event listeners, and GPU resources. |

When changing `particlesTextureSize` on a cube, pass the desired per-level baseline. Changing `elevationStep` recalculates the effective particle texture size. Changing `verticalExaggeration`, `belowSeaLevel`, or `particleHeight` recalculates particle heights.

## Validation errors

The layer rejects invalid data early. Common causes include mismatched U/V lengths, non-positive dimensions, an elevation count different from `depth`, non-finite elevation coordinates, an invalid `elevationStep`, or an effective particle texture larger than the GPU limit.

## Fork lineage and license

- Original project: [hongfaqiu/cesium-wind-layer](https://github.com/hongfaqiu/cesium-wind-layer)
- NOC-OI fork: [NOC-OI/cesium-wind-layer](https://github.com/NOC-OI/cesium-wind-layer)
- Package license: [MIT](/LICENSE)

Copyright and attribution from the original project remain governed by the repository's MIT license. NOC-OI maintains the fork-specific changes described above.

## Acknowledgements

This work is part of the [Atlantis project](https://atlantis.ac.uk/), a UK initiative supporting long-term ocean observations and marine science in the Atlantic. The project is led by the [National Oceanography Centre (NOC)](https://noc.ac.uk/).
