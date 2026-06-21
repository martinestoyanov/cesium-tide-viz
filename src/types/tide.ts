export interface TideRecord {
  Date: string;
  Time: string;
  Height_cm: number;
  Tide_Type: 'High' | 'Low';
}

export interface StationInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
  state: string;
  /**
   * WGS84 ellipsoidal height (meters) of the MLLW tidal datum at this station,
   * i.e. the Cesium-frame elevation where Height_cm === 0. Sourced from NOAA
   * VDatum (MLLW -> IGS14 ellipsoid, GEOID18). Absolute water height in Cesium
   * is therefore: z0Ellipsoid + Height_cm / 100.
   */
  z0Ellipsoid: number;
}

export const STATIONS: StationInfo[] = [
  {
    id: '9437540',
    name: 'Garibaldi',
    lat: 45.55453,
    lon: -123.918945,
    state: 'OR',
    z0Ellipsoid: -23.126,
  },
  {
    id: '9439040',
    name: 'Astoria',
    lat: 46.207306,
    lon: -123.7683,
    state: 'OR',
    z0Ellipsoid: -23.229,
  },
];

/** Scrubber window. Data runs 2026-06-21 -> 2026-07-21; start is clamped per request. */
export const WINDOW_START = Date.parse('2026-06-21T00:00:00Z');
export const WINDOW_END = Date.parse('2026-08-01T00:00:00Z');

/** A tide extremum reduced to an absolute UTC timestamp (ms) + height (cm). */
export interface TideSample {
  t: number;
  h: number;
}

/** Parse raw records into timestamped samples sorted ascending by time. */
export function toSamples(records: TideRecord[]): TideSample[] {
  return records
    .map((r) => ({ t: Date.parse(`${r.Date}T${r.Time}:00Z`), h: r.Height_cm }))
    .filter((s) => Number.isFinite(s.t))
    .sort((a, b) => a.t - b.t);
}

/**
 * Tide height (cm) at an arbitrary time via half-cosine interpolation between
 * consecutive high/low extrema — the natural tidal curve (flat at the turns,
 * steepest mid-cycle). Clamps to the endpoints outside the data range.
 */
export function tideHeightAt(samples: TideSample[], time: number): number {
  if (samples.length === 0) return 0;
  if (time <= samples[0].t) return samples[0].h;
  if (time >= samples[samples.length - 1].t) return samples[samples.length - 1].h;

  // binary search for the bracketing pair
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= time) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const frac = (time - a.t) / (b.t - a.t);
  return (a.h + b.h) / 2 + ((a.h - b.h) / 2) * Math.cos(Math.PI * frac);
}

/** Whether the tide is rising or falling at a given time (next extremum is higher => rising). */
export function tideTrendAt(samples: TideSample[], time: number): 'Rising' | 'Falling' {
  if (samples.length < 2) return 'Rising';
  let hi = 1;
  while (hi < samples.length - 1 && samples[hi].t < time) hi++;
  return samples[hi].h >= samples[hi - 1].h ? 'Rising' : 'Falling';
}

export function getMidpoint(stations: StationInfo[]): [number, number] {
  const avgLat = stations.reduce((s, st) => s + st.lat, 0) / stations.length;
  const avgLon = stations.reduce((s, st) => s + st.lon, 0) / stations.length;
  return [avgLon, avgLat];
}

export function getBoundingRegion(stations: StationInfo[]): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const lons = stations.map((s) => s.lon);
  const lats = stations.map((s) => s.lat);
  const padding = 0.5; // degrees padding
  return {
    west: Math.min(...lons) - padding,
    south: Math.min(...lats) - padding,
    east: Math.max(...lons) + padding,
    north: Math.max(...lats) + padding,
  };
}
