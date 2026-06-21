// Build a Cesium-ion-ready bare-earth terrain GeoTIFF for the Garibaldi <-> Astoria
// corridor, pulled live from the DOGAMI DTM mosaic (no bulk local download).
//
//   exportImage (NAVD88 feet, WGS84 geographic)  ->  ft*0.3048 + geoidN(lat)
//   = WGS84 ellipsoidal meters  ->  one GeoTIFF for ion terrain ingest.
//
// Usage:
//   node scripts/build-lidar-base.mjs --validate   # tiny end-to-end sanity check
//   node scripts/build-lidar-base.mjs              # full ~5 m corridor pull
//
import { fromArrayBuffer, writeArrayBuffer } from 'geotiff';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SERVICE =
  'https://gis.dogami.oregon.gov/arcgis/rest/services/lidar/DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer';

// Corridor bbox (WGS84). Covers Garibaldi coast -> lower Columbia at Astoria.
const WEST = -123.98;
const EAST = -123.72;
const SOUTH = 45.5;
const NORTH = 46.25;

const TARGET_M = 5; // horizontal ground sample distance
const FOOT = 0.3048; // international foot -> meter (DOGAMI is international feet)
const VOID_FILL = -40; // ellipsoidal meters for NoData (ocean) -> always below the tide

// Geoid undulation N (ellipsoidal height of NAVD88=0), from VDatum, interpolated by latitude.
const G = { lat: 45.55453, N: -23.073 }; // Garibaldi
const A = { lat: 46.207306, N: -23.345 }; // Astoria
const geoidN = (lat) => G.N + ((lat - G.lat) * (A.N - G.N)) / (A.lat - G.lat);

// Effective meters-per-degree at corridor mid-latitude (for sizing only).
const midLat = (SOUTH + NORTH) / 2;
const M_PER_DEG_LAT = 111000;
const M_PER_DEG_LON = Math.cos((midLat * Math.PI) / 180) * 111320;

const FULL_W = Math.round(((EAST - WEST) * M_PER_DEG_LON) / TARGET_M);
const FULL_H = Math.round(((NORTH - SOUTH) * M_PER_DEG_LAT) / TARGET_M);
const PSX = (EAST - WEST) / FULL_W; // degrees per pixel (x)
const PSY = (NORTH - SOUTH) / FULL_H; // degrees per pixel (y)

function exportUrl(west, south, east, north, w, h) {
  const qs = new URLSearchParams({
    bbox: `${west},${south},${east},${north}`,
    bboxSR: '4326',
    imageSR: '4326',
    size: `${w},${h}`,
    format: 'tiff',
    pixelType: 'F32',
    noData: '-9999',
    noDataInterpretation: 'esriNoDataMatchAny',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  return `${SERVICE}/exportImage?${qs}`;
}

async function fetchStrip(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const tiff = await fromArrayBuffer(buf);
      const image = await tiff.getImage();
      const [data] = await image.readRasters();
      return { data, width: image.getWidth(), height: image.getHeight(), bytes: buf.byteLength };
    } catch (e) {
      console.warn(`  strip attempt ${i}/${tries} failed: ${e.message}`);
      if (i === tries) throw e;
    }
  }
}

const toEllipsoid = (vFeet, lat) =>
  !Number.isFinite(vFeet) || vFeet <= -9998 || vFeet < -1e30 || vFeet > 1e6
    ? VOID_FILL
    : vFeet * FOOT + geoidN(lat);

async function getSampleFeet(lon, lat) {
  const geom = encodeURIComponent(JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  const url = `${SERVICE}/getSamples?geometry=${geom}&geometryType=esriGeometryPoint&returnFirstValueOnly=true&f=json`;
  const j = await (await fetch(url)).json();
  return parseFloat(j.samples?.[0]?.value);
}

async function writeGeoTiff(values, width, height, originX, originY, outPath) {
  const ab = await writeArrayBuffer(values, {
    width,
    height,
    GTModelTypeGeoKey: 2, // geographic
    GTRasterTypeGeoKey: 1, // PixelIsArea
    GeographicTypeGeoKey: 4326,
    ModelPixelScale: [PSX, PSY, 0],
    ModelTiepoint: [0, 0, 0, originX, originY, 0],
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(ab));
}

async function validate() {
  console.log('=== VALIDATE ===');
  console.log(`full grid would be ${FULL_W} x ${FULL_H} px @ ~${TARGET_M} m`);
  // tiny strip near Garibaldi
  const w = 64;
  const h = 64;
  const bw = -123.95;
  const be = -123.90;
  const bs = 45.54;
  const bn = 45.59;
  console.log('fetching 64x64 test tile near Garibaldi...');
  const { data, width, height, bytes } = await fetchStrip(exportUrl(bw, bs, be, bn, w, h));
  let min = Infinity;
  let max = -Infinity;
  let voids = 0;
  for (const v of data) {
    if (!Number.isFinite(v) || v <= -9998) voids++;
    else {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  console.log(`  got ${width}x${height}, ${(bytes / 1024).toFixed(0)} KB; raw ft range ${min.toFixed(2)}..${max.toFixed(2)}; voids=${voids}`);
  const gs = await getSampleFeet(-123.9189, 45.5545);
  console.log(`  getSamples @ Garibaldi station = ${gs} ft -> ellipsoid ${(gs * FOOT + geoidN(45.5545)).toFixed(2)} m`);
  // write + read back a small ellipsoidal tile
  const ell = Float32Array.from(data, (v, i) => toEllipsoid(v, bn - (Math.floor(i / width) + 0.5) * ((bn - bs) / height)));
  const out = 'C:/Users/ashle/Downloads/lidar-base/_validate.tif';
  await writeGeoTiff(ell, width, height, bw, bn, out);
  const rt = await (await fromArrayBuffer((await import('node:fs')).readFileSync(out).buffer)).getImage();
  console.log(`  wrote + reread ${out}: ${rt.getWidth()}x${rt.getHeight()}, bbox ${JSON.stringify(rt.getBoundingBox())}`);
  console.log('VALIDATE OK');
}

async function full() {
  const OUT = 'C:/Users/ashle/Downloads/lidar-base/garibaldi_astoria_5m_ellipsoid.tif';
  console.log(`=== FULL BUILD ===\ngrid ${FULL_W} x ${FULL_H} px (~${TARGET_M} m), ${(FULL_W * FULL_H * 4 / 1e6).toFixed(0)} MB f32`);
  const full = new Float32Array(FULL_W * FULL_H);
  const STRIP = 2048;
  const nStrips = Math.ceil(FULL_H / STRIP);
  for (let s = 0; s < nStrips; s++) {
    const r0 = s * STRIP;
    const r1 = Math.min(FULL_H, r0 + STRIP);
    const sh = r1 - r0;
    const north = NORTH - r0 * PSY;
    const south = NORTH - r1 * PSY;
    process.stdout.write(`strip ${s + 1}/${nStrips} rows ${r0}-${r1}... `);
    const { data, width } = await fetchStrip(exportUrl(WEST, south, EAST, north, FULL_W, sh));
    for (let j = 0; j < sh; j++) {
      const lat = NORTH - (r0 + j + 0.5) * PSY;
      const N = geoidN(lat);
      const rowOff = (r0 + j) * FULL_W;
      const srcOff = j * width;
      for (let c = 0; c < FULL_W; c++) {
        const v = data[srcOff + c];
        full[rowOff + c] =
          !Number.isFinite(v) || v <= -9998 || v < -1e30 || v > 1e6 ? VOID_FILL : v * FOOT + N;
      }
    }
    console.log('done');
  }
  await writeGeoTiff(full, FULL_W, FULL_H, WEST, NORTH, OUT);
  console.log(`\nWROTE ${OUT}`);
  console.log(`bbox: ${WEST},${SOUTH},${EAST},${NORTH} (WGS84)  |  ${FULL_W}x${FULL_H} @ ~${TARGET_M} m  |  ellipsoidal meters`);
}

const mode = process.argv.includes('--validate') ? validate : full;
mode().catch((e) => {
  console.error(e);
  process.exit(1);
});
