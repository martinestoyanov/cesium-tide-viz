import { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import {
  STATIONS,
  getBoundingRegion,
  toSamples,
  tideHeightAt,
  tideTrendAt,
  WINDOW_START,
  WINDOW_END,
  type StationInfo,
  type TideSample,
} from '@/types/tide';
import { useTideData } from '@/hooks/useTideData';
import { createDogamiLiveTerrain } from '@/lib/dogamiTerrain';
import { createEsriWorldImagery, createOsip2024Imagery } from '@/lib/imagery';

// Cesium ion token - reads from env (set via GitHub Actions secret / .env.local)
const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || '';

// ion asset: Garibaldi–Astoria bare-earth lidar, 5 m, ellipsoidal (base globe terrain).
const ION_TERRAIN_ASSET_ID = 4969633;

const STATION_COLORS = [
  Cesium.Color.fromCssColorString('#ef4444'),
  Cesium.Color.fromCssColorString('#8b5cf6'),
];

const WATER_COLOR = Cesium.Color.fromCssColorString('#1d77d8').withAlpha(0.55);

// Default camera target — coastal point of interest between the stations.
const DEFAULT_VIEW = { lon: -123.94132449718668, lat: 46.0987439521893 };

// Manual frame-step size for the scrubber's back/forward buttons.
const FRAME_STEP_MS = 30 * 60 * 1000; // 30 minutes

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours()
  )}:${p(d.getUTCMinutes())} UTC`;
}

/**
 * Absolute WGS84 ellipsoidal height (meters) of the tide water surface at a
 * given time. Each station is lifted into absolute space (z0Ellipsoid + tide),
 * and we take the HIGHER of the two — we care about worst-case high water, and
 * a single flat max level avoids per-pixel interpolation we can't do live.
 * `offset` is a manual calibration nudge.
 */
function waterHeightAt(
  time: number,
  samplesA: TideSample[],
  samplesB: TideSample[],
  offset: number
): number {
  const zA = STATIONS[0].z0Ellipsoid + tideHeightAt(samplesA, time) / 100 + offset;
  const zB = STATIONS[1].z0Ellipsoid + tideHeightAt(samplesB, time) / 100 + offset;
  return Math.max(zA, zB);
}


function TimeSlider({
  minTime,
  maxTime,
  currentTime,
  onChange,
  isPlaying,
  onTogglePlay,
  readings,
}: {
  minTime: number;
  maxTime: number;
  currentTime: number;
  onChange: (val: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  readings: { station: StationInfo; heightCm: number; trend: 'Rising' | 'Falling' }[];
}) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-black/75 backdrop-blur-md rounded-xl px-6 py-4 text-white min-w-[520px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChange(Math.max(minTime, currentTime - FRAME_STEP_MS))}
            disabled={currentTime <= minTime}
            title="Step back 30 min"
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="2" width="2" height="12" />
              <polygon points="14,2 6,8 14,14" />
            </svg>
          </button>
          <button
            onClick={onTogglePlay}
            className="w-10 h-10 rounded-full bg-sky-500 hover:bg-sky-400 flex items-center justify-center transition-colors"
          >
            {isPlaying ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="2" y="1" width="5" height="14" />
                <rect x="9" y="1" width="5" height="14" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <polygon points="3,1 15,8 3,15" />
              </svg>
            )}
          </button>
          <button
            onClick={() => onChange(Math.min(maxTime, currentTime + FRAME_STEP_MS))}
            disabled={currentTime >= maxTime}
            title="Step forward 30 min"
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <polygon points="2,2 10,8 2,14" />
              <rect x="12" y="2" width="2" height="12" />
            </svg>
          </button>
          <div className="ml-1">
            <div className="text-xs text-gray-400 uppercase tracking-wider">Time</div>
            <div className="text-lg font-mono font-bold">{fmtTime(currentTime)}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400 uppercase tracking-wider">Window</div>
          <div className="text-xs font-mono text-gray-300">
            {fmtTime(minTime).slice(0, 10)} → {fmtTime(maxTime).slice(0, 10)}
          </div>
        </div>
      </div>

      <input
        type="range"
        min={minTime}
        max={maxTime}
        step={5 * 60 * 1000}
        value={currentTime}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-sky-500"
      />

      <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t border-white/10">
        {readings.map(({ station, heightCm, trend }, idx) => (
          <div key={station.id} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: idx === 0 ? '#ef4444' : '#8b5cf6' }}
            />
            <div className="text-sm">
              <span className="font-semibold">{station.name}</span>
              <span className="ml-2 text-lg font-mono font-bold">{heightCm.toFixed(1)} cm</span>
              <span
                className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                  trend === 'Rising'
                    ? 'bg-sky-500/30 text-sky-300'
                    : 'bg-amber-500/30 text-amber-300'
                }`}
              >
                {trend}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CesiumTideViewer() {
  const cesiumContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const waterEntityRef = useRef<Cesium.Entity | null>(null);
  const stationEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const baseTerrainRef = useRef<Cesium.TerrainProvider | null>(null);
  const liveTerrainRef = useRef<Cesium.CustomHeightmapTerrainProvider | null>(null);
  const osipLayerRef = useRef<Cesium.ImageryLayer | null>(null);

  const garibaldiTides = useTideData('9437540');
  const astoriaTides = useTideData('9439040');

  const samplesA = useMemo(() => (garibaldiTides ? toSamples(garibaldiTides) : []), [garibaldiTides]);
  const samplesB = useMemo(() => (astoriaTides ? toSamples(astoriaTides) : []), [astoriaTides]);
  const samplesARef = useRef<TideSample[]>([]);
  const samplesBRef = useRef<TideSample[]>([]);

  // Scrubber bounds: requested window intersected with available data.
  const { tStart, tEnd } = useMemo(() => {
    const all = [...samplesA, ...samplesB];
    const dataStart = all.length ? Math.min(...all.map((s) => s.t)) : WINDOW_START;
    const dataEnd = all.length ? Math.max(...all.map((s) => s.t)) : WINDOW_END;
    return {
      tStart: Math.max(WINDOW_START, dataStart),
      tEnd: Math.min(WINDOW_END, dataEnd),
    };
  }, [samplesA, samplesB]);

  const [currentTime, setCurrentTime] = useState(WINDOW_START);
  const timeRef = useRef(WINDOW_START);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [liveHiRes, setLiveHiRes] = useState(false);
  const [osipImagery, setOsipImagery] = useState(false);
  const [waterOffset, setWaterOffset] = useState(0);
  const offsetRef = useRef(0);
  const [diag, setDiag] = useState<{
    camH: number | null;
    groundH: number | null;
    waterH: number | null;
  }>({ camH: null, groundH: null, waterH: null });

  const setTime = (t: number) => {
    timeRef.current = t;
    setCurrentTime(t);
  };

  const setOffset = (m: number) => {
    offsetRef.current = m;
    setWaterOffset(m);
  };

  // Keep sample refs current for the water surface callback.
  useEffect(() => {
    samplesARef.current = samplesA;
  }, [samplesA]);
  useEffect(() => {
    samplesBRef.current = samplesB;
  }, [samplesB]);

  // Clamp current time into the data window once data is known.
  useEffect(() => {
    setCurrentTime((prev) => {
      const c = Math.min(Math.max(prev, tStart), tEnd);
      timeRef.current = c;
      return c;
    });
  }, [tStart, tEnd]);

  // Initialize Cesium viewer
  useEffect(() => {
    if (!cesiumContainerRef.current) return;
    if (viewerRef.current) return;

    let cancelled = false;

    const initViewer = async () => {
      if (CESIUM_ION_TOKEN) {
        Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
      }

      const boundingRegion = getBoundingRegion(STATIONS);

      // Base globe terrain: our 5 m bare-earth lidar (ion). Falls back to Cesium
      // World Terrain if the asset is still tiling / unavailable.
      let terrainProvider: Cesium.TerrainProvider;
      try {
        terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(ION_TERRAIN_ASSET_ID);
      } catch (error) {
        console.warn('Lidar ion terrain unavailable, falling back to World Terrain:', error);
        terrainProvider = await Cesium.createWorldTerrainAsync({
          requestWaterMask: true,
          requestVertexNormals: true,
        });
      }
      baseTerrainRef.current = terrainProvider;
      liveTerrainRef.current = createDogamiLiveTerrain();

      if (cancelled) return;

      const viewer = new Cesium.Viewer(cesiumContainerRef.current!, {
        terrainProvider,
        baseLayer: false, // we manage imagery explicitly (Esri World Imagery base)
        baseLayerPicker: false,
        sceneModePicker: true,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        homeButton: true,
        geocoder: false,
        fullscreenButton: false,
        vrButton: false,
        shouldAnimate: true,
        skyAtmosphere: new Cesium.SkyAtmosphere(),
      });

      viewerRef.current = viewer;

      // --- Imagery: Esri World Imagery base + OSIP 2024 overlay (toggled, hidden by default) ---
      try {
        const esri = await createEsriWorldImagery();
        if (cancelled) return;
        viewer.imageryLayers.addImageryProvider(esri);
      } catch (error) {
        console.warn('Esri World Imagery failed to load:', error);
      }
      const osipLayer = viewer.imageryLayers.addImageryProvider(createOsip2024Imagery());
      osipLayer.show = false;
      osipLayerRef.current = osipLayer;

      // --- Image quality settings ---
      viewer.useBrowserRecommendedResolution = false; // render at full device pixel ratio (sharpness)
      viewer.scene.globe.maximumScreenSpaceError = 1; // load higher-detail tiles (default 2)
      viewer.scene.msaaSamples = 4; // hardware anti-aliasing
      viewer.scene.globe.depthTestAgainstTerrain = true; // occlude water/geometry behind terrain

      // Full, unconstrained camera control (pan / tilt / zoom / rotate / look).
      const ssc = viewer.scene.screenSpaceCameraController;
      ssc.enableRotate = true;
      ssc.enableTranslate = true;
      ssc.enableZoom = true;
      ssc.enableTilt = true;
      ssc.enableLook = true;

      // Initial camera: oblique view onto the coastal point of interest.
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(DEFAULT_VIEW.lon, DEFAULT_VIEW.lat - 0.025, 3500),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-35),
          roll: 0,
        },
      });

      // Region outline (decorative; visible in globe mode).
      viewer.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            boundingRegion.west,
            boundingRegion.south,
            boundingRegion.east,
            boundingRegion.north
          ),
          material: Cesium.Color.TRANSPARENT,
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#0ea5e9').withAlpha(0.5),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      });

      // Station pins (clamp to whichever surface is present: terrain or 3D tiles).
      STATIONS.forEach((station, idx) => {
        const pinBuilder = new Cesium.PinBuilder();
        const pinEntity = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(station.lon, station.lat, 0),
          billboard: {
            image: pinBuilder.fromColor(STATION_COLORS[idx], 48).toDataURL(),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${station.name}\n${station.id}`,
            font: 'bold 14px sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, -50),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
        stationEntitiesRef.current.set(station.id, pinEntity);
      });

      // Tide water surface — a translucent plane at absolute ellipsoidal height,
      // recomputed every frame from the current scrubber time. The terrain / 3D
      // tiles clip it, so the intersection edge reads as the waterline.
      const waterEntity = viewer.entities.add({
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(
            boundingRegion.west,
            boundingRegion.south,
            boundingRegion.east,
            boundingRegion.north
          ),
          // Dynamic absolute height on a finely tessellated rectangle that
          // FOLLOWS the ellipsoid (a wide perPositionHeight polygon would sag
          // hundreds of meters below the curved surface mid-span). A
          // CallbackProperty keeps the geometry dynamic so height changes update
          // in place instead of rebuilding the rectangle (which flashed).
          height: new Cesium.CallbackProperty(
            () =>
              waterHeightAt(timeRef.current, samplesARef.current, samplesBRef.current, offsetRef.current),
            false
          ),
          granularity: Cesium.Math.toRadians(0.04),
          material: WATER_COLOR,
        },
      });
      waterEntityRef.current = waterEntity;

      setIsReady(true);
    };

    initViewer();

    return () => {
      cancelled = true;
      const viewer = viewerRef.current;
      if (viewer) {
        viewer.destroy();
        viewerRef.current = null;
      }
      stationEntitiesRef.current.clear();
      waterEntityRef.current = null;
    };
  }, []);

  // Swap globe terrain between the 5 m ion base and the live native DOGAMI feed.
  useEffect(() => {
    const viewer = viewerRef.current;
    const base = baseTerrainRef.current;
    if (!viewer || !base) return;
    viewer.terrainProvider = liveHiRes && liveTerrainRef.current ? liveTerrainRef.current : base;
  }, [liveHiRes, isReady]);

  // Toggle the OSIP 2024 Oregon 1-ft imagery overlay.
  useEffect(() => {
    if (osipLayerRef.current) osipLayerRef.current.show = osipImagery;
  }, [osipImagery, isReady]);

  // Playback: advance the scrubber smoothly, looping within the data window.
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setCurrentTime((prev) => {
        let next = prev + 60 * 60 * 1000; // +1 hour per tick
        if (next > tEnd) next = tStart;
        timeRef.current = next;
        return next;
      });
    }, 80);
    return () => clearInterval(id);
  }, [isPlaying, tStart, tEnd]);

  // Live diagnostics: sample camera height, the ground height under screen
  // center (3D tiles / terrain), and our computed water height, every 250ms.
  useEffect(() => {
    if (!isReady) return;
    const id = setInterval(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const scene = viewer.scene;
      const camH = viewer.camera.positionCartographic.height;

      let groundH: number | null = null;
      const t = timeRef.current;
      if (scene.pickPositionSupported) {
        const canvas = scene.canvas;
        const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        const picked = scene.pickPosition(center);
        if (picked) groundH = Cesium.Cartographic.fromCartesian(picked).height;
      }
      // The rendered water surface is flat at the region-midpoint height.
      const waterH = waterHeightAt(t, samplesARef.current, samplesBRef.current, offsetRef.current);
      setDiag({ camH, groundH, waterH });
    }, 250);
    return () => clearInterval(id);
  }, [isReady]);

  const readings = STATIONS.map((station, idx) => {
    const s = idx === 0 ? samplesA : samplesB;
    return {
      station,
      heightCm: tideHeightAt(s, currentTime),
      trend: tideTrendAt(s, currentTime),
    };
  });

  const dataReady = samplesA.length > 0 && samplesB.length > 0;

  return (
    <div className="relative w-full h-screen">
      {/* Cesium container */}
      <div ref={cesiumContainerRef} className="w-full h-full" />

      {/* Overlay header */}
      <div className="absolute top-4 left-4 z-10 bg-black/75 backdrop-blur-md rounded-xl px-5 py-3 text-white">
        <h1 className="text-lg font-bold">NOAA Tides 3D Viewer</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          Garibaldi, OR (9437540) &amp; Astoria, OR (9439040)
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Water surface = higher of the two stations (WGS84 / MLLW via VDatum)
        </p>
        <button
          onClick={() => setLiveHiRes((v) => !v)}
          title="Stream native 3 ft DOGAMI lidar (live) instead of the 5 m base"
          className={`mt-3 w-full text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors ${
            liveHiRes
              ? 'bg-emerald-500 hover:bg-emerald-400 text-white'
              : 'bg-white/10 hover:bg-white/20 text-gray-200'
          }`}
        >
          {liveHiRes ? '● Live hi-res lidar' : '○ Live hi-res lidar'}
        </button>

        <button
          onClick={() => setOsipImagery((v) => !v)}
          title="Overlay Oregon Statewide Imagery (OSIP) 2024, 1-ft, on the Esri World Imagery base"
          className={`mt-2 w-full text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors ${
            osipImagery
              ? 'bg-amber-500 hover:bg-amber-400 text-white'
              : 'bg-white/10 hover:bg-white/20 text-gray-200'
          }`}
        >
          {osipImagery ? '● Oregon 1-ft imagery' : '○ Oregon 1-ft imagery'}
        </button>

        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Water offset</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={waterOffset}
                step={0.5}
                onChange={(e) => setOffset(parseFloat(e.target.value) || 0)}
                className="w-20 bg-white/10 rounded px-1.5 py-0.5 text-sm font-mono text-right text-white outline-none focus:bg-white/20"
              />
              <span className="text-xs text-gray-400">m</span>
            </div>
          </div>
          <input
            type="range"
            min={-50}
            max={50}
            step={0.25}
            value={waterOffset}
            onChange={(e) => setOffset(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-rose-500"
          />
          <div className="flex justify-between text-[10px] text-gray-500 mt-0.5 font-mono">
            <span>−50 m</span>
            <span>0</span>
            <span>+50 m</span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-white/10 text-xs font-mono space-y-0.5">
          <div className="flex justify-between">
            <span className="text-gray-400">Water @ center</span>
            <span>{diag.waterH != null ? `${diag.waterH.toFixed(1)} m` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Ground @ center</span>
            <span>{diag.groundH != null ? `${diag.groundH.toFixed(1)} m` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Δ (ground − water)</span>
            <span
              className={diag.groundH != null && diag.waterH != null ? 'text-rose-300' : ''}
            >
              {diag.groundH != null && diag.waterH != null
                ? `${(diag.groundH - diag.waterH).toFixed(1)} m`
                : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Camera height</span>
            <span>{diag.camH != null ? `${diag.camH.toFixed(0)} m` : '—'}</span>
          </div>
        </div>
      </div>

      {/* Center crosshair — marks the point the "Ground @ center" reading samples */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
        <div className="w-5 h-5 border border-white/70 rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-white rounded-full" />
      </div>

      {/* Time slider */}
      {dataReady && (
        <TimeSlider
          minTime={tStart}
          maxTime={tEnd}
          currentTime={currentTime}
          onChange={setTime}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying(!isPlaying)}
          readings={readings}
        />
      )}
    </div>
  );
}
