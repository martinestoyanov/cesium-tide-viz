# NOAA Tides 3D Viewer (CesiumJS)

A CesiumJS app that visualizes **where the tide reaches relative to real ground**
along the northern Oregon coast, between two NOAA tide stations. A translucent
water surface is placed at the true tide elevation and clips against
high‑resolution bare‑earth **lidar terrain**, so you can scrub through time and
watch the waterline move up and down the beach.

**Live site:** https://martinestoyanov.github.io/cesium-tide-viz/

## Stations

| ID | Name | Location |
|----|------|----------|
| 9437540 | Garibaldi | 45.5545 N, 123.9189 W (Oregon) |
| 9439040 | Astoria | 46.2073 N, 123.7683 W (Oregon) |

Both are in Oregon, so the whole corridor is covered by Oregon (DOGAMI / OSIP)
lidar and imagery.

## How it works

The hard part is putting tide height and ground elevation in the **same vertical
frame**. NOAA tide predictions are relative to the **MLLW** tidal datum; Cesium
renders in **WGS84 ellipsoidal** height. They differ by ~23 m here.

1. **Tide → absolute elevation.** Each station's MLLW datum is converted to a
   WGS84 ellipsoidal height `z0` via [NOAA VDatum](https://vdatum.noaa.gov/)
   (GEOID18 / IGS14). The water elevation at a station is `z0 + tideHeight + offset`.
2. **One conservative level.** We take the **higher of the two stations**
   (`max`) rather than interpolating across the view — we care about worst‑case
   high water, and a single flat max level avoids per‑pixel interpolation we
   can't do live. Set in `waterHeightAt()`.
3. **Smooth time.** The CSVs hold only high/low extrema, so tide height is
   **cosine‑interpolated** between consecutive turns (the natural tidal curve).
4. **Curved water plane.** The surface is a finely tessellated `rectangle` at
   that absolute height — it follows the ellipsoid's curvature (a wide flat
   polygon would sag hundreds of meters mid‑span). It updates via a
   `CallbackProperty` so height changes don't rebuild/flash the geometry.
5. **Lidar ground.** The water clips against bare‑earth lidar terrain, so the
   intersection edge reads as the waterline.

## Features

- **Lidar terrain (hybrid):**
  - *Base* — a 5 m bare‑earth DEM of the Garibaldi↔Astoria corridor, hosted on
    Cesium ion (`ION_TERRAIN_ASSET_ID` in `CesiumTideViewer.tsx`), built by
    `scripts/build-lidar-base.mjs` from the DOGAMI DTM mosaic.
  - *Live hi‑res toggle* — streams **native ~3 ft** DOGAMI bare earth on demand
    via a `CustomHeightmapTerrainProvider` (one `exportImage` call per terrain
    tile, converted feet→meters + geoid on the fly).
- **Imagery:** Esri World Imagery base + a toggle for **OSIP 2024** Oregon 1‑ft
  orthoimagery.
- **Time scrubber:** play/pause, **frame‑by‑frame stepping** (±30 min), and a
  draggable timeline over the data window.
- **Calibration + diagnostics:** a manual water‑offset slider and a live readout
  of water height, ground height under the crosshair, their delta, and camera
  height.
- **Free camera:** unconstrained pan / tilt / zoom / rotate.

## Data sources

- **Tides:** [NOAA CO‑OPS](https://api.tidesandcurrents.noaa.gov/) hi/lo
  predictions (MLLW, GMT), in `public/data/tidal_data_station_*.csv`.
- **Datum transform:** [NOAA VDatum](https://vdatum.noaa.gov/) (MLLW & NAVD88 → WGS84 ellipsoidal).
- **Lidar (bare earth):** [DOGAMI Digital Terrain Model mosaic](https://gis.dogami.oregon.gov/arcgis/rest/services/lidar/DIGITAL_TERRAIN_MODEL_MOSAIC/ImageServer)
  (NAD83 Oregon Lambert, NAVD88 feet).
- **Imagery:** Esri World Imagery; [OSIP 2024](https://imagery.oregonexplorer.info/arcgis/rest/services/OSIP_2024/OSIP_2024_WM/ImageServer).
- **Globe/terrain hosting:** Cesium ion.

## Setup & run

```bash
npm install

# Dev: provide a Cesium ion token via .env.local (gitignored)
echo "VITE_CESIUM_ION_TOKEN=your_token_here" > .env.local
npm run dev      # http://localhost:3000/cesium-tide-viz/
```

The ion token must belong to the account that owns the terrain asset
(`ION_TERRAIN_ASSET_ID`). Without a token the app falls back to Cesium World
Terrain and stock imagery.

### Live lidar / OSIP need the dev proxies

The **Live hi‑res lidar** and **Oregon 1‑ft imagery** toggles call ArcGIS
services through Vite dev proxies (`/dogami`, `/osip`) to avoid CORS — see
`vite.config.ts`. These work in `npm run dev` but **not** on a plain static
build (GitHub Pages); a serverless proxy would be needed in production. The 5 m
ion base terrain and Esri imagery work everywhere.

### Rebuilding the lidar base DEM

`scripts/build-lidar-base.mjs` pulls the corridor from the DOGAMI ImageServer
(server‑side resampled — no bulk download), converts NAVD88 feet → WGS84
ellipsoidal meters, and writes a single GeoTIFF for ion:

```bash
node scripts/build-lidar-base.mjs --validate   # quick sanity check
node scripts/build-lidar-base.mjs              # full ~5 m corridor GeoTIFF
```

Upload the GeoTIFF to Cesium ion as **Terrain**, **Height unit = Meters**,
**Height reference = Ellipsoid (WGS84)**, then set its asset id as
`ION_TERRAIN_ASSET_ID`.

## Project structure

```
.
├── public/data/
│   ├── tidal_data_station_9437540.csv   # Garibaldi predictions (MLLW, GMT)
│   └── tidal_data_station_9439040.csv   # Astoria predictions
├── scripts/
│   └── build-lidar-base.mjs             # DOGAMI -> ion terrain GeoTIFF builder
├── src/
│   ├── components/CesiumTideViewer.tsx  # main viewer (water, terrain, imagery, UI)
│   ├── lib/
│   │   ├── dogamiTerrain.ts             # live native lidar terrain provider
│   │   └── imagery.ts                   # Esri World Imagery + OSIP providers
│   ├── hooks/useTideData.ts             # CSV loader
│   └── types/tide.ts                    # stations, datums, tide interpolation
├── vite.config.ts                       # Vite + Cesium plugin + /dogami,/osip proxies
└── package.json
```

> Note: a raw DOGAMI lidar quad download under `src/lidar/` is **gitignored** —
> the app pulls from the ArcGIS API instead.

## Notes

- All elevations in the app are **WGS84 ellipsoidal meters**. DOGAMI lidar
  (NAVD88 feet) and NOAA tides (MLLW) are converted into that frame.
- The water surface is intentionally a single flat max‑of‑two‑stations level —
  conservative for high water, not a physically interpolated sea surface.
