import { Cartesian3 } from 'cesium';

export interface WindLayerOptions {
  /**
   * Size of the particle texture for one elevation. For cubes, the texture is
   * scaled by the square root of the active elevation count so each level
   * retains approximately this many particles (size squared). Default is 100.
   */
  particlesTextureSize: number;
  /**
   * Height of particles above the ground in meters. Default is 1000.
   */
  particleHeight: number;
  /**
   * Width range of particle trails in pixels. Default is { min: 1, max: 2 }.
   * Controls the width of the particles.
   * @property {number} min - Minimum width of particle trails
   * @property {number} max - Maximum width of particle trails
   */
  lineWidth: {
    min: number;
    max: number;
  };
  /**
   * Length range of particle trails. Default is { min: 20, max: 100 }.
   * @property {number} min - Minimum length of particle trails
   * @property {number} max - Maximum length of particle trails
   */
  lineLength: {
    min: number;
    max: number;
  };
  /**
   * Factor to adjust the speed of particles. Default is 1.0.
   * Controls the movement speed of particles.
   */
  speedFactor: number;
  /**
   * Rate at which particles are dropped (reset). Default is 0.003.
   * Controls the lifecycle of particles.
   */
  dropRate: number;
  /**
   * Additional drop rate for slow-moving particles. Default is 0.01.
   * Increases the probability of dropping particles when they move slowly.
   */
  dropRateBump: number;
  /**
   * Whether to flip the Y-axis of the wind data. Default is false.
   * @deprecated Prefer `WindData.latIsAscending`; this remains as a low-level compatibility override.
   */
  flipY: boolean;
  /** Scale applied to cube elevation coordinates. Default is 1. */
  verticalExaggeration: number;
  /** Interpret cube elevation coordinates as depths below sea level. Default is false. */
  belowSeaLevel: boolean;
  /** Interval between elevation levels populated with particles. Default is 1. */
  elevationStep: number;
  /**
   * Array of colors for particles. Can be used to create color gradients.
   * Default is ['white'].
   */
  colors: string[];
  /**
   * Whether to use the viewer bounds to generate particles. Default is false.
   */
  useViewerBounds?: boolean;
  /**
   * Minimum fraction of the overview particle scale retained while zooming.
   * Use 1 to disable camera-driven scaling. Default is 0.6.
   */
  minVisibleRatio: number;
  /**
   * Controls the speed rendering range. Default is undefined.
   * @property {number} [min] - Minimum speed value for rendering
   * @property {number} [max] - Maximum speed value for rendering
   */
  domain?: {
    min?: number;
    max?: number;
  };
  /**
   * Controls the speed display range for visualization. Default is undefined.
   * @property {number} [min] - Minimum speed value for display
   * @property {number} [max] - Maximum speed value for display
   */
  displayRange?: {
    min?: number;
    max?: number;
  };
  /**
   * Whether to enable dynamic particle animation. Default is true.
   * When set to false, particles will remain static.
   */
  dynamic: boolean;
}

export interface WindDataDemention {
  array: Float32Array;
  min?: number;
  max?: number;
}

export interface WindData {
  u: WindDataDemention;
  v: WindDataDemention;
  speed?: WindDataDemention;
  width: number;
  height: number;
  /** True when array rows progress from south to north. */
  latIsAscending?: boolean;
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

/** A velocity cube flattened in elevation-latitude-longitude order. */
export interface WindCubeData extends WindData {
  depth: number;
  elevations: ArrayLike<number>;
  /** True when elevation indices progress from lower to higher coordinate values. */
  elevationIsAscending?: boolean;
}

export type WindFieldData = WindData | WindCubeData;

/** Wind data after validation and derived speed/height calculation. */
export interface ProcessedWindData extends WindCubeData {
  speed: WindDataDemention;
  particleHeights: Float32Array;
}

export interface Particle {
  position: Cartesian3;
  age: number;
}

export interface WindDataAtLonLat {
  /**
   * Original data at the grid point
   */
  original: {
    /**
     * Original U component
     */
    u: number;
    /**
     * Original V component
     */
    v: number;
    /**
     * Original speed
     */
    speed: number;
  };
  /**
   * Interpolated data between grid points
   */
  interpolated: {
    /**
     * Interpolated U component
     */
    u: number;
    /**
     * Interpolated V component
     */
    v: number;
    /**
     * Interpolated speed
     */
    speed: number;
  };
}
