import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execFileSync } from "node:child_process";

export default defineConfig({
  // When this config is loaded from the repo root (`vite build --config client/vite.config.ts`),
  // Vite otherwise defaults to process.cwd() and looks for /index.html in the wrong place.
  root: __dirname,
  define: {
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  plugins: [react(), {
    name: "mealscout-authorized-preview-qa",
    apply: "build",
    closeBundle() {
      // Only this authorized PR preview: production and ordinary builds are unchanged.
      // The child executor strips DB/provider credentials and uses disposable fixtures.
      if (process.env.VERCEL_ENV === "preview" &&
          process.env.VERCEL_GIT_COMMIT_REF === "codex/ui-ux-front-end-overhaul-20260915") {
        execFileSync(process.execPath, [path.resolve(__dirname, "../scripts/qa/run-preview-journeys.cjs")],
          { cwd: path.resolve(__dirname, ".."), stdio: "inherit", timeout: 900_000 });
      }
    },
  }],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "..", "shared"),
      "@assets": path.resolve(__dirname, "..", "attached_assets"),
    },
  },
  build: {
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
