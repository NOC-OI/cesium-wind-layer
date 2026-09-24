import {
  Viewer,
  Scene,
  Cartesian2,
  SceneMode,
  Math as CesiumMath,
  Rectangle
} from 'cesium';

import { WindLayerOptions, WindData, WindCubeData, WindFieldData, WindDataAtLonLat, ProcessedWindData } from './types';
import { WindParticleSystem } from './windParticleSystem';
import { deepMerge } from './utils';

export * from './types';

type WindLayerEventType = 'dataChange' | 'optionsChange';
type WindLayerEventCallback = (data: WindFieldData | WindLayerOptions) => void;

function effectiveParticleTextureSize(baseSize: number, depth: number, elevationStep: number): number {
  const activeLevels = Math.ceil(depth / elevationStep);
  return Math.ceil(baseSize * Math.sqrt(activeLevels));
}

export const DefaultOptions: WindLayerOptions = {
  particlesTextureSize: 100,
  dropRate: 0.003,
  particleHeight: 1000,
  dropRateBump: 0.01,
  speedFactor: 1.0,
  lineWidth: { min: 1, max: 2 },
  lineLength: { min: 20, max: 100 },
  colors: ['white'],
  flipY: false,
  verticalExaggeration: 1,
  belowSeaLevel: false,
  elevationStep: 1,
  useViewerBounds: false,
  minVisibleRatio: 0.6,
  domain: undefined,
  displayRange: undefined,
  dynamic: true
}

export class WindLayer {
  private _show: boolean = true;
  private _resized: boolean = false;
  windData: ProcessedWindData;

  get show(): boolean {
    return this._show;
  }

  set show(value: boolean) {
    if (this._show !== value) {
      this._show = value;
      this.updatePrimitivesVisibility(value);
    }
  }

  static defaultOptions: WindLayerOptions = DefaultOptions;

  viewer: Viewer;
  scene: Scene;
  options: WindLayerOptions;
  private particleSystem: WindParticleSystem;
  private viewerParameters: {
    lonRange: Cartesian2;
    latRange: Cartesian2;
    pixelSize: number;
    sceneMode: SceneMode;
  };
  private _isDestroyed: boolean = false;
  private primitives: any[] = [];
  private eventListeners: Map<WindLayerEventType, Set<WindLayerEventCallback>> = new Map();
  private flipYOverride?: boolean;
  private isCubeData: boolean;
  private particleTextureSizePerLevel: number;
  private readonly viewerChangedListener = () => this.updateViewerParameters();
  private readonly resizeListener = () => this.updateViewerParameters();

  /**
   * WindLayer class for visualizing wind field data with particle animation in Cesium.
   *
   * @class
   * @param {Viewer} viewer - The Cesium viewer instance.
   * @param {WindFieldData} windData - The 2D wind field or complete velocity cube to visualize.
   * @param {Partial<WindLayerOptions>} [options] - Optional configuration options for the wind layer.
   * @param {number} [options.particlesTextureSize=100] - Texture dimension for 2D data, or the per-level particle-density baseline for a cube.
   * @param {number} [options.particleHeight=1000] - Height of 2D particles above the ground in meters.
   * @param {Object} [options.lineWidth={ min: 1, max: 2 }] - Width range of particle trails.
   * @param {Object} [options.lineLength={ min: 20, max: 100 }] - Length range of particle trails.
   * @param {number} [options.speedFactor=1.0] - Factor to adjust the speed of particles.
   * @param {number} [options.dropRate=0.003] - Rate at which particles are dropped (reset).
   * @param {number} [options.dropRateBump=0.001] - Additional drop rate for slow-moving particles.
   * @param {string[]} [options.colors=['white']] - Array of colors for particles. Can be used to create color gradients.
   * @param {boolean} [options.flipY=false] - Deprecated 2D-only texture-orientation override. Use windData.latIsAscending.
   * @param {number} [options.verticalExaggeration=1] - Multiplier applied to cube elevation coordinates.
   * @param {boolean} [options.belowSeaLevel=false] - Whether cube levels extend downwards from their maximum elevation.
   * @param {number} [options.elevationStep=1] - Positive integer interval between populated cube levels.
   * @param {boolean} [options.useViewerBounds=false] - Whether to use the viewer bounds to generate particles.
   * @param {number} [options.minVisibleRatio=0.6] - Minimum overview scale retained while zooming; use 1 to disable zoom scaling.
   * @param {boolean} [options.dynamic=true] - Whether to enable dynamic particle animation.
   */
  constructor(viewer: Viewer, windData: WindFieldData, options?: Partial<WindLayerOptions>) {
    this.show = true;
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.isCubeData = 'depth' in windData;
    this.flipYOverride = this.isCubeData ? undefined : options?.flipY;
    const semanticFlipY = windData.latIsAscending === undefined
      ? WindLayer.defaultOptions.flipY
      : !windData.latIsAscending;
    const derivedFlipY = this.isCubeData ? semanticFlipY : options?.flipY ?? semanticFlipY;
    const mergedOptions = { ...WindLayer.defaultOptions, ...options, flipY: derivedFlipY };
    this.particleTextureSizePerLevel = mergedOptions.particlesTextureSize;
    const depth = 'depth' in windData ? windData.depth : 1;
    mergedOptions.particlesTextureSize = effectiveParticleTextureSize(
      this.particleTextureSizePerLevel,
      depth,
      mergedOptions.elevationStep
    );
    if (mergedOptions.particlesTextureSize > this.scene.context.maximumTextureSize) {
      throw new RangeError(
        `Cube particle texture size ${mergedOptions.particlesTextureSize} exceeds the GPU limit ` +
        `${this.scene.context.maximumTextureSize}`
      );
    }
    this.options = mergedOptions;
    this.windData = this.processWindData(windData);

    this.viewerParameters = {
      lonRange: new Cartesian2(-180, 180),
      latRange: new Cartesian2(-90, 90),
      pixelSize: 1000.0,
      sceneMode: this.scene.mode
    };
    this.updateViewerParameters();

    this.particleSystem = new WindParticleSystem(this.scene.context, this.windData, this.options, this.viewerParameters, this.scene);
    this.add();

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.viewer.camera.percentageChanged = 0.01;
    this.viewer.camera.changed.addEventListener(this.viewerChangedListener);
    this.scene.morphComplete.addEventListener(this.viewerChangedListener);
    window.addEventListener("resize", this.resizeListener);
  }

  private removeEventListeners(): void {
    this.viewer.camera.changed.removeEventListener(this.viewerChangedListener);
    this.scene.morphComplete.removeEventListener(this.viewerChangedListener);
    window.removeEventListener("resize", this.resizeListener);
  }

  private processWindData(windData: WindFieldData): ProcessedWindData {
    const depth = 'depth' in windData ? windData.depth : 1;
    const elevations = 'elevations' in windData ? Array.from(windData.elevations, Number) : [this.options.particleHeight];
    const expectedLength = windData.width * windData.height * depth;
    if (!Number.isInteger(windData.width) || windData.width < 1 ||
      !Number.isInteger(windData.height) || windData.height < 1 ||
      !Number.isInteger(depth) || depth < 1) {
      throw new RangeError('Wind data dimensions must be positive integers');
    }
    if (windData.u.array.length !== expectedLength || windData.v.array.length !== expectedLength) {
      throw new RangeError(`Wind component arrays must contain ${expectedLength} values`);
    }
    if (elevations.length !== depth || elevations.some(value => !Number.isFinite(value))) {
      throw new RangeError('Wind cube elevations must be finite and match its depth');
    }
    if (this.options.elevationStep < 1 || !Number.isInteger(this.options.elevationStep)) {
      throw new RangeError('elevationStep must be a positive integer');
    }
    if (windData.speed?.array && windData.speed.array.length !== expectedLength) {
      throw new RangeError(`Wind speed array must contain ${expectedLength} values`);
    }
    if (windData.speed?.min === undefined || windData.speed?.max === undefined || windData.speed.array === undefined) {
      const speed = {
        array: new Float32Array(windData.u.array.length),
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY
      };
      for (let i = 0; i < windData.u.array.length; i++) {
        speed.array[i] = Math.sqrt(windData.u.array[i] * windData.u.array[i] + windData.v.array[i] * windData.v.array[i]);
        if (speed.array[i] !== 0) {
          speed.min = Math.min(speed.min, speed.array[i]);
          speed.max = Math.max(speed.max, speed.array[i]);
        }
      }
      if (!Number.isFinite(speed.min)) speed.min = 0;
      if (!Number.isFinite(speed.max)) speed.max = 0;
      windData = { ...windData, speed };
    }

    const maximumElevation = Math.max(...elevations);
    const particleHeights = Float32Array.from(elevations, elevation =>
      this.options.belowSeaLevel
        ? -(maximumElevation - elevation) * this.options.verticalExaggeration
        : elevation * this.options.verticalExaggeration
    );
    return {
      ...windData,
      speed: windData.speed!,
      depth,
      elevations,
      elevationIsAscending: 'elevationIsAscending' in windData
        ? windData.elevationIsAscending
        : elevations.length < 2 || elevations[0] < elevations[elevations.length - 1],
      particleHeights
    };
  }

  /**
   * Get the wind data at a specific longitude and latitude.
   * @param {number} lon - The longitude.
   * @param {number} lat - The latitude.
   * @returns {Object} - An object containing the u, v, and speed values at the specified coordinates.
   */
  getDataAtLonLat(lon: number, lat: number, elevationIndex: number = 0): WindDataAtLonLat | null {
    const { bounds, width, height, depth, u, v, speed } = this.windData;
    const { flipY } = this.options;

    // Check if the coordinates are within bounds
    if (lon < bounds.west || lon > bounds.east || lat < bounds.south || lat > bounds.north ||
      !Number.isInteger(elevationIndex) || elevationIndex < 0 || elevationIndex >= depth) {
      return null;
    }

    // Calculate normalized coordinates
    const xNorm = (lon - bounds.west) / (bounds.east - bounds.west) * (width - 1);
    let yNorm = (lat - bounds.south) / (bounds.north - bounds.south) * (height - 1);

    // Apply flipY if enabled
    if (flipY) {
      yNorm = height - 1 - yNorm;
    }

    // Get exact grid point for original values
    const x = Math.floor(xNorm);
    const y = Math.floor(yNorm);

    // Get the four surrounding grid points for interpolation
    const x0 = Math.floor(xNorm);
    const x1 = Math.min(x0 + 1, width - 1);
    const y0 = Math.floor(yNorm);
    const y1 = Math.min(y0 + 1, height - 1);

    // Calculate interpolation weights
    const wx = xNorm - x0;
    const wy = yNorm - y0;

    // Get indices
    const levelOffset = elevationIndex * width * height;
    const index = levelOffset + y * width + x;
    const i00 = levelOffset + y0 * width + x0;
    const i10 = levelOffset + y0 * width + x1;
    const i01 = levelOffset + y1 * width + x0;
    const i11 = levelOffset + y1 * width + x1;

    // Bilinear interpolation for u component
    const u00 = u.array[i00];
    const u10 = u.array[i10];
    const u01 = u.array[i01];
    const u11 = u.array[i11];
    const uInterp = (1 - wx) * (1 - wy) * u00 + wx * (1 - wy) * u10 +
      (1 - wx) * wy * u01 + wx * wy * u11;

    // Bilinear interpolation for v component
    const v00 = v.array[i00];
    const v10 = v.array[i10];
    const v01 = v.array[i01];
    const v11 = v.array[i11];
    const vInterp = (1 - wx) * (1 - wy) * v00 + wx * (1 - wy) * v10 +
      (1 - wx) * wy * v01 + wx * wy * v11;

    // Calculate interpolated speed
    const interpolatedSpeed = Math.sqrt(uInterp * uInterp + vInterp * vInterp);

    return {
      original: {
        u: u.array[index],
        v: v.array[index],
        speed: speed.array[index],
      },
      interpolated: {
        u: uInterp,
        v: vInterp,
        speed: interpolatedSpeed,
      }
    };
  }

  private updateViewerParameters(): void {
    const scene = this.viewer.scene;
    const canvas = scene.canvas;
    const corners = [
      { x: 0, y: 0 },
      { x: 0, y: canvas.clientHeight },
      { x: canvas.clientWidth, y: 0 },
      { x: canvas.clientWidth, y: canvas.clientHeight }
    ];

    // Convert screen corners to cartographic coordinates
    let minLon = 180;
    let maxLon = -180;
    let minLat = 90;
    let maxLat = -90;
    let isOutsideGlobe = false;

    for (const corner of corners) {
      const cartesian = scene.camera.pickEllipsoid(
        new Cartesian2(corner.x, corner.y),
        scene.globe.ellipsoid
      );

      if (!cartesian) {
        isOutsideGlobe = true;
        break;
      }

      const cartographic = scene.globe.ellipsoid.cartesianToCartographic(cartesian);
      const lon = CesiumMath.toDegrees(cartographic.longitude);
      const lat = CesiumMath.toDegrees(cartographic.latitude);

      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    if (isOutsideGlobe) {
      // In a globe overview the canvas corners usually fall outside the
      // ellipsoid. Keeping the previous values here leaves the layer stuck
      // with the shorter/slower styling calculated for the last zoomed-in
      // region. Restore the full data extent and overview scale instead.
      this.viewerParameters.lonRange = new Cartesian2(
        this.windData.bounds.west,
        this.windData.bounds.east
      );
      this.viewerParameters.latRange = new Cartesian2(
        this.windData.bounds.south,
        this.windData.bounds.north
      );
      this.viewerParameters.pixelSize = 1000.0;
    } else { // -30 degrees in radians
      // Calculate intersection with data bounds
      const lonRange = new Cartesian2(
        Math.max(this.windData.bounds.west, minLon),
        Math.min(this.windData.bounds.east, maxLon)
      );
      const latRange = new Cartesian2(
        Math.max(this.windData.bounds.south, minLat),
        Math.min(this.windData.bounds.north, maxLat)
      );

      // Add 5% buffer to lonRange and latRange
      const lonBuffer = (lonRange.y - lonRange.x) * 0.05;
      const latBuffer = (latRange.y - latRange.x) * 0.05;

      lonRange.x = Math.max(this.windData.bounds.west, lonRange.x - lonBuffer);
      lonRange.y = Math.min(this.windData.bounds.east, lonRange.y + lonBuffer);
      latRange.x = Math.max(this.windData.bounds.south, latRange.x - latBuffer);
      latRange.y = Math.min(this.windData.bounds.north, latRange.y + latBuffer);

      this.viewerParameters.lonRange = lonRange;
      this.viewerParameters.latRange = latRange;
      // Calculate pixelSize based on the visible range
      const dataLonRange = this.windData.bounds.east - this.windData.bounds.west;
      const dataLatRange = this.windData.bounds.north - this.windData.bounds.south;

      // Calculate the ratio of visible area to total data area based on the shortest side
      const visibleRatioLon = (lonRange.y - lonRange.x) / dataLonRange;
      const visibleRatioLat = (latRange.y - latRange.x) / dataLatRange;
      const visibleRatio = Math.min(visibleRatioLon, visibleRatioLat);
      const minVisibleRatio = Math.max(0, Math.min(1, this.options.minVisibleRatio));
      const clampedVisibleRatio = Math.max(minVisibleRatio, Math.min(1, visibleRatio));

      // Retain a configurable portion of the overview scale while zooming.
      const pixelSize = 1000 * clampedVisibleRatio;
      if (pixelSize > 0) {
        this.viewerParameters.pixelSize = Math.max(0, Math.min(1000, pixelSize));
      }
    }


    this.viewerParameters.sceneMode = this.scene.mode;
    this.particleSystem?.applyViewerParameters(this.viewerParameters);
  }

  /**
   * Update the wind data of the wind layer.
   * @param {WindFieldData} data - The new 2D wind field or complete velocity cube to apply.
   */
  updateWindData(data: WindFieldData): void {
    if (this._isDestroyed) return;
    this.isCubeData = 'depth' in data;
    if ((this.isCubeData || this.flipYOverride === undefined) && data.latIsAscending !== undefined) {
      this.options.flipY = !data.latIsAscending;
      this.particleSystem.options.flipY = this.options.flipY;
      this.particleSystem.computing.options.flipY = this.options.flipY;
    }
    const depth = 'depth' in data ? data.depth : 1;
    const particleTextureSize = effectiveParticleTextureSize(
      this.particleTextureSizePerLevel,
      depth,
      this.options.elevationStep
    );
    if (particleTextureSize > this.scene.context.maximumTextureSize) {
      throw new RangeError(
        `Cube particle texture size ${particleTextureSize} exceeds the GPU limit ` +
        `${this.scene.context.maximumTextureSize}`
      );
    }
    this.windData = this.processWindData(data);
    if (particleTextureSize !== this.options.particlesTextureSize) {
      this.particleSystem.changeOptions({ particlesTextureSize: particleTextureSize });
      this.options.particlesTextureSize = particleTextureSize;
    }
    this.particleSystem.computing.updateWindData(this.windData);
    this.viewer.scene.requestRender();
    // Dispatch data change event
    this.dispatchEvent('dataChange', this.windData);
  }

  /**
   * Update the options of the wind layer.
   * @param {Partial<WindLayerOptions>} options - The new options to apply.
   */
  updateOptions(options: Partial<WindLayerOptions>): void {
    if (this._isDestroyed) return;
    if (!this.isCubeData && options.flipY !== undefined) this.flipYOverride = options.flipY;
    if (this.isCubeData && options.flipY !== undefined) {
      options = { ...options };
      delete options.flipY;
    }
    if (options.elevationStep !== undefined &&
      (!Number.isInteger(options.elevationStep) || options.elevationStep < 1)) {
      throw new RangeError('elevationStep must be a positive integer');
    }
    if (options.verticalExaggeration !== undefined && options.verticalExaggeration <= 0) {
      throw new RangeError('verticalExaggeration must be greater than zero');
    }
    const particleTextureSizePerLevel = options.particlesTextureSize ?? this.particleTextureSizePerLevel;
    if (options.particlesTextureSize !== undefined) {
      if (!Number.isFinite(particleTextureSizePerLevel) || particleTextureSizePerLevel <= 0) {
        throw new RangeError('particlesTextureSize must be greater than zero');
      }
    }
    const elevationStep = options.elevationStep ?? this.options.elevationStep;
    const particleTextureSize = effectiveParticleTextureSize(
      particleTextureSizePerLevel,
      this.windData.depth,
      elevationStep
    );
    if (particleTextureSize > this.scene.context.maximumTextureSize) {
      throw new RangeError(
        `Cube particle texture size ${particleTextureSize} exceeds the GPU limit ` +
        `${this.scene.context.maximumTextureSize}`
      );
    }
    this.particleTextureSizePerLevel = particleTextureSizePerLevel;
    options = { ...options, particlesTextureSize: particleTextureSize };
    const heightChanged = options.verticalExaggeration !== undefined ||
      options.belowSeaLevel !== undefined || options.particleHeight !== undefined;
    this.options = deepMerge(options, this.options);
    if (heightChanged) {
      this.windData = this.processWindData(this.windData);
      this.particleSystem.computing.updateWindData(this.windData);
    }
    this.particleSystem.changeOptions(options);
    this.viewer.scene.requestRender();
    // Dispatch options change event
    this.dispatchEvent('optionsChange', this.options);
  }

  /**
   * Zoom to the wind data bounds.
   * @param {number} [duration=0] - The duration of the zoom animation.
   */
  zoomTo(duration: number = 0): void {
    if (this.windData.bounds) {
      const rectangle = Rectangle.fromDegrees(
        this.windData.bounds.west,
        this.windData.bounds.south,
        this.windData.bounds.east,
        this.windData.bounds.north
      );
      this.viewer.camera.flyTo({
        destination: rectangle,
        duration,
      });
    }
  }

  /**
   * Add the wind layer to the scene.
   */
  add(): void {
    this.primitives = this.particleSystem.getPrimitives();
    this.primitives.forEach(primitive => {
      this.scene.primitives.add(primitive);
    });
  }

  /**
   * Remove the wind layer from the scene.
   */
  remove(): void {
    this.primitives.forEach(primitive => {
      this.scene.primitives.remove(primitive);
    });
    this.primitives = [];
  }

  /**
   * Check if the wind layer is destroyed.
   * @returns {boolean} - True if the wind layer is destroyed, otherwise false.
   */
  isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Destroy the wind layer and release all resources.
   */
  destroy(): void {
    this.remove();
    this.removeEventListeners();
    this.particleSystem.destroy();
    // Clear all event listeners
    this.eventListeners.clear();
    this._isDestroyed = true;
  }

  private updatePrimitivesVisibility(visibility?: boolean): void {
    const show = visibility !== undefined ? visibility : this._show;
    this.primitives.forEach(primitive => {
      primitive.show = show;
    });
  }

  /**
   * Add an event listener for the specified event type.
   * @param {WindLayerEventType} type - The type of event to listen for.
   * @param {WindLayerEventCallback} callback - The callback function to execute when the event occurs.
   */
  addEventListener(type: WindLayerEventType, callback: WindLayerEventCallback) {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)?.add(callback);
  }

  /**
   * Remove an event listener for the specified event type.
   * @param {WindLayerEventType} type - The type of event to remove.
   * @param {WindLayerEventCallback} callback - The callback function to remove.
   */
  removeEventListener(type: WindLayerEventType, callback: WindLayerEventCallback) {
    this.eventListeners.get(type)?.delete(callback);
  }

  private dispatchEvent(type: WindLayerEventType, data: WindFieldData | WindLayerOptions) {
    this.eventListeners.get(type)?.forEach(callback => callback(data));
  }

}

export type { WindLayerOptions, WindData, WindCubeData, WindFieldData, WindLayerEventType, WindLayerEventCallback };
