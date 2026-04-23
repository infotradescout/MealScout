import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  // When this config is loaded from the repo root (`vite build --config client/vite.config.ts`),
  // Vite otherwise defaults to process.cwd() and looks for /index.html in the wrong place.
  root: __dirname,
  define: {
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "..", "shared"),
      "@assets": path.resolve(__dirname, "..", "attached_assets"),
    },
  },
  build: {
    // Build client artifacts into client/dist for frontend-only deploy targets.
    // Platform builds copy this output into dist/public for the Node server.
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor code for better caching
          "react-vendor": ["react", "react-dom"],
          "router-vendor": ["wouter"],
          "query-vendor": ["@tanstack/react-query"],
          "ui-vendor": ["lucide-react"],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5174,
    proxy: {
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
