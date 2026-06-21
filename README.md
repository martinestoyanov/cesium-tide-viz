# NOAA Tides 3D Viewer (CesiumJS)

A CesiumJS-based 3D visualization of NOAA tidal data for two Pacific Northwest stations.

**Live Site:** https://martinestoyanov.github.io/cesium-tide-viz/

## Stations

| ID | Name | Location |
|----|------|----------|
| 9437540 | Garibaldi | 45.55N, 123.92W (Oregon) |
| 9440581 | Cape Disappointment | 46.28N, 124.05W (Washington) |

## Features

- **3D Terrain**: Cesium World Terrain with water mask and vertex normals
- **Tide Visualization**: Animated 3D cylinders showing tide height at each station
- **Time Slider**: Scrub through 30 days of tidal predictions with play/pause
- **Camera Constraints**: View is clamped to the region between the two stations
- **Region Overlay**: Visual boundary showing the active study area
- **Color Coding**: Blue = High Tide, Amber = Low Tide

## Setup

### 1. Add Your Cesium ion Token (GitHub Actions Secret)

The Cesium ion token is configured as a **GitHub Actions repository secret** (never hardcoded in source):

1. Go to your repo on GitHub → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `CESIUM_ION_TOKEN`
4. Value: Your token from [cesium.com/ion](https://cesium.com/ion)
5. Click **Add secret**

The workflow (`.github/workflows/deploy.yml`) injects this secret into the build automatically:

```yaml
env:
  VITE_CESIUM_ION_TOKEN: ${{ secrets.CESIUM_ION_TOKEN }}
```

The source code reads it at build time via:

```typescript
const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || '';
```

### 2. Install & Run Locally

```bash
npm install

# Run without token (limited terrain)
npm run dev

# Run with token
VITE_CESIUM_ION_TOKEN=your_token_here npm run dev
```

### 3. Build for Production

```bash
# Without token
npm run build

# With token
VITE_CESIUM_ION_TOKEN=your_token_here npm run build
```

## Deploy to GitHub Pages

Already configured! On every push to `main`, GitHub Actions:

1. Checks out the code
2. Installs Node.js 20 + dependencies
3. Builds with your secret token injected
4. Deploys `dist/` to GitHub Pages

**Enable it once:**
1. Go to **Settings** → **Pages**
2. **Source**: Select **GitHub Actions**

Then push to `main` — the site will be live at `https://martinestoyanov.github.io/cesium-tide-viz/`.

## Project Structure

```
.
├── .github/workflows/deploy.yml              # Auto-deploy workflow
├── public/data/
│   ├── tidal_data_station_9437540.csv        # Garibaldi tide data
│   └── tidal_data_station_9440581.csv        # Cape Disappointment tide data
├── src/
│   ├── components/
│   │   └── CesiumTideViewer.tsx              # Main 3D viewer
│   ├── hooks/
│   │   └── useTideData.ts                    # CSV data loading hook
│   ├── types/
│   │   └── tide.ts                           # Station info & helpers
│   ├── App.tsx
│   └── main.tsx
├── vite.config.ts                            # Vite + Cesium plugin
└── package.json
```

## CORS Notes

This project is designed to run as a **self-contained static application**. All tide data is loaded from local CSV files (no external API calls at runtime). The only external dependency is Cesium's terrain/imagery servers which handle CORS automatically.

## Customization Ideas

- Add a 3D Tileset (e.g., buildings) by loading a Cesium ion asset ID
- Add water level rise/fall animation
- Show tidal current vectors
- Add more stations by updating `STATIONS` in `src/types/tide.ts`
- Adjust camera constraints in the viewer initialization
