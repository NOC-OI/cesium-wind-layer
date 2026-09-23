import type { WindData } from 'cube-cesium-wind-layer';
import * as zarr from 'zarrita';

const CURRENT_URLS = {
  u: 'https://atlantis-vis-o.s3-ext.jc.rl.ac.uk/nemotest101/currents/uo.zarr',
  v: 'https://atlantis-vis-o.s3-ext.jc.rl.ac.uk/nemotest101/currents/vo.zarr',
} as const;

const CURRENT_VARIABLES = { u: 'uo', v: 'vo' } as const;

type NumericArray = ArrayLike<number | bigint>;

async function openV2Array(url: string, variable: string) {
  const root = zarr.root(new zarr.FetchStore(url));
  return zarr.open.v2(root.resolve(variable), { kind: 'array' });
}

async function readCoordinates(url: string) {
  const root = zarr.root(new zarr.FetchStore(url));
  const [longitudeArray, latitudeArray] = await Promise.all([
    zarr.open.v2(root.resolve('longitude'), { kind: 'array' }),
    zarr.open.v2(root.resolve('latitude'), { kind: 'array' }),
  ]);
  const [longitude, latitude] = await Promise.all([
    zarr.get(longitudeArray),
    zarr.get(latitudeArray),
  ]);

  return {
    longitude: Array.from(longitude.data as NumericArray, Number),
    latitude: Array.from(latitude.data as NumericArray, Number),
  };
}

function sanitizeAndRotate(
  values: NumericArray,
  width: number,
  height: number,
  longitude: number[],
) {
  const output = new Float32Array(width * height);
  const pivot = longitude.findIndex(value => value >= 180);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Rotate 0..360 datasets when necessary; -180..180 datasets pass through.
      const sourceX = pivot < 0 ? x : (x + pivot) % width;
      const value = Number(values[y * width + sourceX]);
      output[y * width + x] = Number.isFinite(value) ? value : 0;
    }
  }

  return output;
}

async function readSurface(url: string, variable: string) {
  const array = await openV2Array(url, variable);
  // currents_2d_v2 selects the first time and surface elevation from [t, z, y, x].
  const result = await zarr.get(array, [0, 0, null, null]);
  return result.data as NumericArray;
}

/** Load the currents_2d_v2 surface slice and adapt it to cesium-wind-layer. */
export async function loadGlobalZarrCurrents(): Promise<WindData> {
  const [{ longitude, latitude }, u, v] = await Promise.all([
    readCoordinates(CURRENT_URLS.u),
    readSurface(CURRENT_URLS.u, CURRENT_VARIABLES.u),
    readSurface(CURRENT_URLS.v, CURRENT_VARIABLES.v),
  ]);
  const width = longitude.length;
  const height = latitude.length;

  return {
    u: { array: sanitizeAndRotate(u, width, height, longitude), min: -1, max: 1 },
    v: { array: sanitizeAndRotate(v, width, height, longitude), min: -1, max: 1 },
    width,
    height,
    bounds: {
      west: -180,
      south: Math.min(...latitude),
      east: 180,
      north: Math.max(...latitude),
    },
  };
}
