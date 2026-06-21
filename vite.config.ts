import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import cesium from "vite-plugin-cesium"

export default defineConfig({
  base: '/cesium-tide-viz/',
  plugins: [react(), cesium()],
  server: {
    port: 3000,
    proxy: {
      // Proxy DOGAMI lidar ImageServer to dodge CORS for the live hi-res terrain.
      '/dogami': {
        target: 'https://gis.dogami.oregon.gov',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/dogami/, ''),
      },
      // Proxy OSIP imagery (oregonexplorer) for the Oregon 1-ft imagery toggle.
      '/osip': {
        target: 'https://imagery.oregonexplorer.info',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/osip/, ''),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
  }
});
