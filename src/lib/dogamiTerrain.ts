import * as Cesium from 'cesium';
import { fromArrayBuffer } from 'geotiff';

// Live high-res bare-earth terrain streamed from the DOGAMI DTM mosaic.
// Each Cesium terrain tile -> one exportImage call (proxied via /dogami),
// decoded and converted NAVD88 feet -> WGS84 ellipsoidal meters on the fly.

const SERVICE = '/dogami/arcgis/rest/services/lidar/DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer';
const FOOT = 0.3048; // international foot -> meter
const VOID_FILL = -40; // ellipsoidal meters for NoData/ocean (always below the tide)

// Geoid undulation N (ellipsoidal height of NAVD88=0), interpolated by latitude
// between the two stations (VDatum / GEOID18).
const STN_A = { lat: 45.55453, N: -23.073 }; // Garibaldi
const STN_B = { lat: 46.207306, N: -23.345 }; // Astoria
const geoidN = (lat: number) => STN_A.N + ((lat - STN_A.lat) * (STN_B.N - STN_A.N)) / (STN_B.lat - STN_A.lat);

// Coarse gate: don't fetch for tiles outside Oregon (DOGAMI has no data there).
const OR_BOUNDS = { west: -125.0, south: 41.8, east: -116.4, north: 46.4 };
// Only fetch live tiles within this zoom band (below = too-broad area; covered by base).
const MIN_LEVEL = 9;

const TILE = 64; // heightmap samples per tile edge

function voidTile(): Float32Array {
  return new Float32Array(TILE * TILE).fill(VOID_FILL);
}

async function fetchTile(rect: Cesium.Rectangle): Promise<Float32Array> {
  const west = Cesium.Math.toDegrees(rect.west);
  const south = Cesium.Math.toDegrees(rect.south);
  const east = Cesium.Math.toDegrees(rect.east);
  const north = Cesium.Math.toDegrees(rect.north);
  const url =
    `${SERVICE}/exportImage?bbox=${west},${south},${east},${north}` +
    `&bboxSR=4326&imageSR=4326&size=${TILE},${TILE}&format=tiff&pixelType=F32` +
    `&noData=-9999&noDataInterpretation=esriNoDataMatchAny&interpolation=RSP_BilinearInterpolation&f=image`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`exportImage HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const img = await tiff.getImage();
  const [data] = await img.readRasters(); // row-major, north row first (matches Cesium heightmap)

  const out = new Float32Array(TILE * TILE);
  for (let r = 0; r < TILE; r++) {
    const lat = north - ((r + 0.5) / TILE) * (north - south);
    const N = geoidN(lat);
    for (let c = 0; c < TILE; c++) {
      const v = (data as unknown as Float32Array)[r * TILE + c];
      out[r * TILE + c] =
        !Number.isFinite(v) || v <= -9998 || v < -1e30 || v > 1e6 ? VOID_FILL : v * FOOT + N;
    }
  }
  return out;
}

export function createDogamiLiveTerrain(): Cesium.CustomHeightmapTerrainProvider {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  const cache = new Map<string, Float32Array | Promise<Float32Array>>();

  return new Cesium.CustomHeightmapTerrainProvider({
    width: TILE,
    height: TILE,
    tilingScheme,
    callback: (x, y, level) => {
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const west = Cesium.Math.toDegrees(rect.west);
      const south = Cesium.Math.toDegrees(rect.south);
      const east = Cesium.Math.toDegrees(rect.east);
      const north = Cesium.Math.toDegrees(rect.north);

      const outside =
        east < OR_BOUNDS.west ||
        west > OR_BOUNDS.east ||
        north < OR_BOUNDS.south ||
        south > OR_BOUNDS.north;
      if (outside || level < MIN_LEVEL) return voidTile();

      const key = `${level}/${x}/${y}`;
      let entry = cache.get(key);
      if (!entry) {
        entry = fetchTile(rect).catch(() => voidTile());
        cache.set(key, entry);
      }
      return entry;
    },
  });
}
