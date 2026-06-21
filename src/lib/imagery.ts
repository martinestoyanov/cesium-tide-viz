import * as Cesium from 'cesium';

// Esri World Imagery — global high-res aerial base (1 m or better; sub-meter in
// many areas). Public ArcGIS MapServer, CORS-enabled, no token needed.
export function createEsriWorldImagery(): Promise<Cesium.ArcGisMapServerImageryProvider> {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
  );
}

// OSIP 2024 — Oregon Statewide Imagery, 1-ft (0.3 m) 4-band orthoimagery flown
// summer 2024. A tiled Web-Mercator cache; served through the /osip proxy.
// Bounded to Oregon so Cesium doesn't request tiles outside coverage.
const OSIP_RECTANGLE = Cesium.Rectangle.fromDegrees(-124.63, 42.0, -116.43, 46.4);

export function createOsip2024Imagery(): Cesium.UrlTemplateImageryProvider {
  return new Cesium.UrlTemplateImageryProvider({
    url: '/osip/arcgis/rest/services/OSIP_2024/OSIP_2024_WM/ImageServer/tile/{z}/{y}/{x}',
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    tileWidth: 256,
    tileHeight: 256,
    maximumLevel: 21,
    rectangle: OSIP_RECTANGLE,
    credit: new Cesium.Credit('Oregon Statewide Imagery Program (OSIP) 2024'),
  });
}
