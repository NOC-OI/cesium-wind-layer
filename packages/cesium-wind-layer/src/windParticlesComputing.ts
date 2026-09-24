import { PixelDatatype, PixelFormat, Sampler, Texture, TextureMagnificationFilter, TextureMinificationFilter, Cartesian2, Cartesian3, FrameRateMonitor } from 'cesium';
import { WindLayerOptions, ProcessedWindData } from './types';
import { ShaderManager } from './shaderManager';
import CustomPrimitive from './customPrimitive'
import { deepMerge } from './utils';

export class WindParticlesComputing {
  context: any;
  options: WindLayerOptions;
  viewerParameters: any;
  windTextures!: {
    U: Texture;
    V: Texture;
    elevation: Texture;
  };
  particlesTextures!: {
    previousParticlesPosition: Texture;
    currentParticlesPosition: Texture;
    nextParticlesPosition: Texture;
    postProcessingPosition: Texture;
    particlesSpeed: Texture;
  };
  primitives!: {
    calculateSpeed: CustomPrimitive;
    updatePosition: CustomPrimitive;
    postProcessingPosition: CustomPrimitive;
  };
  windData: ProcessedWindData;
  private atlas = { columns: 1, rows: 1, width: 1, height: 1 };
  private frameRateMonitor: FrameRateMonitor;
  frameRate: number = 60;
  frameRateAdjustment: number = 1;

  constructor(context: any, windData: ProcessedWindData, options: WindLayerOptions, viewerParameters: any, scene: any) {
    this.context = context;
    this.options = options;
    this.viewerParameters = viewerParameters;
    this.windData = windData;

    this.frameRateMonitor = new FrameRateMonitor({
      scene: scene,
      samplingWindow: 1.0,
      quietPeriod: 0.0
    });
    this.initFrameRate();
    this.createWindTextures();
    this.createParticlesTextures();
    this.createComputingPrimitives();
  }

  private initFrameRate() {
    const updateFrameRate = () => {
      // avoid update frame rate when frame rate is too low
      if (this.frameRateMonitor.lastFramesPerSecond > 20) {
        this.frameRate = this.frameRateMonitor.lastFramesPerSecond;
        this.frameRateAdjustment = 60 / Math.max(this.frameRate, 1);
      }
    }

    // Initial frame rate calculation
    updateFrameRate();

    // Use setInterval instead of requestAnimationFrame
    const intervalId = setInterval(updateFrameRate, 1000);

    // Monitor frame rate changes
    this.frameRateMonitor.lowFrameRate.addEventListener((scene, frameRate) => {
      console.warn(`Low frame rate detected: ${frameRate} FPS`);
    });

    this.frameRateMonitor.nominalFrameRate.addEventListener((scene, frameRate) => {
      console.log(`Frame rate returned to normal: ${frameRate} FPS`);
    });

    // Add cleanup method to destroy
    const originalDestroy = this.destroy.bind(this);
    this.destroy = () => {
      clearInterval(intervalId);
      originalDestroy();
    };
  }

  createWindTextures() {
    const maxTextureSize = this.context.maximumTextureSize ?? 16384;
    const columns = Math.min(this.windData.depth, Math.floor(maxTextureSize / this.windData.width));
    const rows = Math.ceil(this.windData.depth / columns);
    const atlasWidth = this.windData.width * columns;
    const atlasHeight = this.windData.height * rows;
    if (columns < 1 || atlasHeight > maxTextureSize || this.windData.depth > maxTextureSize) {
      throw new RangeError(`Wind cube cannot fit in a ${maxTextureSize}px GPU texture atlas`);
    }
    this.atlas = { columns, rows, width: atlasWidth, height: atlasHeight };
    const pack = (source: Float32Array): Float32Array => {
      const result = new Float32Array(atlasWidth * atlasHeight);
      const sliceSize = this.windData.width * this.windData.height;
      for (let level = 0; level < this.windData.depth; level++) {
        const atlasColumn = level % columns;
        const atlasRow = Math.floor(level / columns);
        for (let y = 0; y < this.windData.height; y++) {
          const sourceY = this.options.flipY ? this.windData.height - 1 - y : y;
          const sourceOffset = level * sliceSize + sourceY * this.windData.width;
          const targetOffset = (atlasRow * this.windData.height + y) * atlasWidth + atlasColumn * this.windData.width;
          result.set(source.subarray(sourceOffset, sourceOffset + this.windData.width), targetOffset);
        }
      }
      return result;
    };
    const options = {
      context: this.context,
      width: atlasWidth,
      height: atlasHeight,
      pixelFormat: PixelFormat.RED,
      pixelDatatype: PixelDatatype.FLOAT,
      flipY: false,
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.LINEAR,
        magnificationFilter: TextureMagnificationFilter.LINEAR
      })
    }
    const packedU = pack(this.windData.u.array);
    const packedV = pack(this.windData.v.array);

    this.windTextures = {
      U: new Texture({
        ...options,
        source: {
          arrayBufferView: packedU
        }
      }),
      V: new Texture({
        ...options,
        source: {
          arrayBufferView: packedV
        }
      }),
      elevation: new Texture({
        context: this.context,
        width: this.windData.depth,
        height: 1,
        pixelFormat: PixelFormat.RED,
        pixelDatatype: PixelDatatype.FLOAT,
        sampler: new Sampler({
          minificationFilter: TextureMinificationFilter.NEAREST,
          magnificationFilter: TextureMagnificationFilter.NEAREST
        }),
        source: { arrayBufferView: this.windData.particleHeights }
      })
    };
  }

  createParticlesTextures() {
    const options = {
      context: this.context,
      width: this.options.particlesTextureSize,
      height: this.options.particlesTextureSize,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.FLOAT,
      flipY: false,
      source: {
        arrayBufferView: new Float32Array(this.options.particlesTextureSize * this.options.particlesTextureSize * 4).fill(0)
      },
      sampler: new Sampler({
        minificationFilter: TextureMinificationFilter.NEAREST,
        magnificationFilter: TextureMagnificationFilter.NEAREST
      })
    }

    this.particlesTextures = {
      previousParticlesPosition: new Texture(options),
      currentParticlesPosition: new Texture(options),
      nextParticlesPosition: new Texture(options),
      postProcessingPosition: new Texture(options),
      particlesSpeed: new Texture(options)
    };
  }

  destroyParticlesTextures() {
    Object.values(this.particlesTextures).forEach(texture => texture.destroy());
  }

  createComputingPrimitives() {
    this.primitives = {
      calculateSpeed: new CustomPrimitive({
        commandType: 'Compute',
        uniformMap: {
          U: () => this.windTextures.U,
          V: () => this.windTextures.V,
          elevation: () => this.windTextures.elevation,
          uRange: () => new Cartesian2(this.windData.u.min, this.windData.u.max),
          vRange: () => new Cartesian2(this.windData.v.min, this.windData.v.max),
          speedRange: () => new Cartesian2(this.windData.speed.min, this.windData.speed.max),
          currentParticlesPosition: () => this.particlesTextures.currentParticlesPosition,
          speedScaleFactor: () => {
            return (this.viewerParameters.pixelSize + 50) * this.options.speedFactor;
          },
          frameRateAdjustment: () => this.frameRateAdjustment,
          dimension: () => new Cartesian3(this.windData.width, this.windData.height, this.windData.depth),
          atlasDimension: () => new Cartesian2(this.atlas.width, this.atlas.height),
          atlasGrid: () => new Cartesian2(this.atlas.columns, this.atlas.rows),
          minimum: () => new Cartesian2(this.windData.bounds.west, this.windData.bounds.south),
          maximum: () => new Cartesian2(this.windData.bounds.east, this.windData.bounds.north),
        },
        fragmentShaderSource: ShaderManager.getCalculateSpeedShader(),
        outputTexture: this.particlesTextures.particlesSpeed,
        preExecute: () => {
          const temp = this.particlesTextures.previousParticlesPosition;
          this.particlesTextures.previousParticlesPosition = this.particlesTextures.currentParticlesPosition;
          this.particlesTextures.currentParticlesPosition = this.particlesTextures.postProcessingPosition;
          this.particlesTextures.postProcessingPosition = temp;
          if (this.primitives.calculateSpeed.commandToExecute) {
            this.primitives.calculateSpeed.commandToExecute.outputTexture = this.particlesTextures.particlesSpeed;
          }
        },
        isDynamic: () =>this.options.dynamic
      }),

      updatePosition: new CustomPrimitive({
        commandType: 'Compute',
        uniformMap: {
          currentParticlesPosition: () => this.particlesTextures.currentParticlesPosition,
          particlesSpeed: () => this.particlesTextures.particlesSpeed,
        },
        fragmentShaderSource: ShaderManager.getUpdatePositionShader(),
        outputTexture: this.particlesTextures.nextParticlesPosition,
        preExecute: () => {
          if (this.primitives.updatePosition.commandToExecute) {
            this.primitives.updatePosition.commandToExecute.outputTexture = this.particlesTextures.nextParticlesPosition;
          }
        },
        isDynamic: () => this.options.dynamic
      }),

      postProcessingPosition: new CustomPrimitive({
        commandType: 'Compute',
        uniformMap: {
          nextParticlesPosition: () => this.particlesTextures.nextParticlesPosition,
          particlesSpeed: () => this.particlesTextures.particlesSpeed,
          lonRange: () => this.viewerParameters.lonRange,
          latRange: () => this.viewerParameters.latRange,
          dataLonRange: () => new Cartesian2(this.windData.bounds.west, this.windData.bounds.east),
          dataLatRange: () => new Cartesian2(this.windData.bounds.south, this.windData.bounds.north),
          randomCoefficient: function () {
            return Math.random();
          },
          dropRate: () => this.options.dropRate,
          dropRateBump: () => this.options.dropRateBump,
          useViewerBounds: () => this.options.useViewerBounds,
          depth: () => this.windData.depth,
          elevationStep: () => this.options.elevationStep
        },
        fragmentShaderSource: ShaderManager.getPostProcessingPositionShader(),
        outputTexture: this.particlesTextures.postProcessingPosition,
        preExecute: () => {
          if (this.primitives.postProcessingPosition.commandToExecute) {
            this.primitives.postProcessingPosition.commandToExecute.outputTexture = this.particlesTextures.postProcessingPosition;
          }
        },
        isDynamic: () => this.options.dynamic
      })
    };
  }

  private reCreateWindTextures() {
    Object.values(this.windTextures).forEach(texture => texture.destroy());
    this.createWindTextures();
  }

  updateWindData(data: ProcessedWindData) {
    this.windData = data;
    this.reCreateWindTextures();
  }

  updateOptions(options: Partial<WindLayerOptions>) {
    const needUpdateWindTextures = options.flipY !== undefined && options.flipY !== this.options.flipY;
    this.options = deepMerge(options, this.options);
    if (needUpdateWindTextures) {
      this.reCreateWindTextures();
    }
  }

  processWindData(data: {
    array: Float32Array;
    min?: number;
    max?: number;
  }): Float32Array {
    const { array } = data;
    let { min, max } = data;
    const result = new Float32Array(array.length);
    if (min === undefined) {
      console.warn('min is undefined, calculate min');
      min = Math.min(...array);
    }
    if (max === undefined) {
      console.warn('max is undefined, calculate max');
      max = Math.max(...array);
    }

    const maxNum = Math.max(Math.abs(min), Math.abs(max));

    for (let i = 0; i < array.length; i++) {
      const value = array[i] / maxNum; // Normalize to [-1, 1]
      result[i] = value;
    }
    return result;
  }

  destroy() {
    Object.values(this.windTextures).forEach(texture => texture.destroy());
    Object.values(this.particlesTextures).forEach(texture => texture.destroy());
    Object.values(this.primitives).forEach(primitive => primitive.destroy());
    this.frameRateMonitor.destroy();
  }
}
