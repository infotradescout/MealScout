import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = __dirname;
const clientRoot = path.resolve(repoRoot, "client");
const localMapRuntimeProxyTarget =
  process.env.MEALSCOUT_LOCAL_MAP_RUNTIME_PROXY_TARGET ||
  "http://localhost:5200";

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(clientRoot, "src"),
      "@shared": path.resolve(repoRoot, "shared"),
      "@assets": path.resolve(repoRoot, "attached_assets"),
    },
  },
  root: clientRoot,
  build: {
    outDir: path.resolve(repoRoot, "dist", "public"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api/map/runtime": {
        target: localMapRuntimeProxyTarget,
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:5200",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:5200",
        changeOrigin: true,
        ws: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
