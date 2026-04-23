import { createRoot } from "react-dom/client";
import App from "./App";
import "leaflet/dist/leaflet.css";
import "./index.css";
import { LocaleProvider } from "@/lib/i18n";

function installPerformanceCompatShim() {
  if (typeof window === "undefined") return;
  const perf = window.performance as Performance | undefined;
  if (!perf) return;
  const perfAny = perf as any;

  if (typeof perf.mark !== "function") {
    perfAny.mark = () => {
      // no-op compatibility fallback
      return undefined;
    };
  }

  if (typeof perf.measure !== "function") {
    perfAny.measure = () => {
      // no-op compatibility fallback
      return undefined;
    };
  }

  if (typeof perf.clearMarks !== "function") {
    perfAny.clearMarks = () => {
      // no-op compatibility fallback
    };
  }

  if (typeof perf.clearMeasures !== "function") {
    perfAny.clearMeasures = () => {
      // no-op compatibility fallback
    };
  }
}

installPerformanceCompatShim();

function shouldEnablePwaRuntime() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "www.mealscout.us" || host === "mealscout.us") return true;
  if (host === "mealscout.onrender.com") return true;
  return false;
}

function ensureManifestLink() {
  if (typeof document === "undefined") return;
  const existing = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = "/manifest.json";
  document.head.appendChild(link);
}

if (import.meta.env.PROD) {
  const routeBudgetKey = `mealscout_chunk_reload_budget:${encodeURIComponent(
    window.location.pathname,
  )}`;
  const maxReloadAttempts = 6;
  const reloadWindowMs = 5 * 60 * 1000;
  const getReloadState = (): { attempts: number; firstAt: number } => {
    try {
      const raw = sessionStorage.getItem(routeBudgetKey);
      if (!raw) return { attempts: 0, firstAt: Date.now() };
      const parsed = JSON.parse(raw) as {
        attempts?: number;
        firstAt?: number;
      };
      const attempts = Number(parsed?.attempts || 0);
      const firstAt = Number(parsed?.firstAt || Date.now());
      if (!Number.isFinite(attempts) || !Number.isFinite(firstAt)) {
        return { attempts: 0, firstAt: Date.now() };
      }
      if (Date.now() - firstAt > reloadWindowMs) {
        return { attempts: 0, firstAt: Date.now() };
      }
      return { attempts, firstAt };
    } catch {
      return { attempts: 0, firstAt: Date.now() };
    }
  };
  const canReload = () => getReloadState().attempts < maxReloadAttempts;
  const consumeReloadAttempt = () => {
    try {
      const current = getReloadState();
      sessionStorage.setItem(
        routeBudgetKey,
        JSON.stringify({
          attempts: current.attempts + 1,
          firstAt: current.firstAt,
        }),
      );
    } catch {
      // ignore
    }
  };

  const reloadWithBust = () => {
    if (!canReload()) return;
    consumeReloadAttempt();
    const url = new URL(window.location.href);
    url.searchParams.set("reload", Date.now().toString());
    window.location.replace(url.toString());
  };

  const isChunkError = (message?: string) =>
    Boolean(
      message &&
        (message.includes("Failed to fetch dynamically imported module") ||
          message.includes("Loading chunk") ||
          message.includes("module script") ||
          message.includes("MIME type")),
    );

  window.addEventListener("vite:preloadError", reloadWithBust);
  window.addEventListener("error", (event) => {
    if (isChunkError(event.message)) {
      reloadWithBust();
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as Error | string | undefined;
    const message =
      typeof reason === "string" ? reason : reason?.message || "";
    if (isChunkError(message)) {
      reloadWithBust();
    }
  });
}

// Keep manifest for installability, but disable SW runtime caching to prevent
// stale chunk and MIME-type failures after deploys.
if (import.meta.env.PROD && shouldEnablePwaRuntime()) {
  ensureManifestLink();
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const swResetKey = "mealscout_sw_reset_done";
  const hasReset = (() => {
    try {
      return sessionStorage.getItem(swResetKey) === "1";
    } catch {
      return false;
    }
  })();

  const markReset = () => {
    try {
      sessionStorage.setItem(swResetKey, "1");
    } catch {
      // ignore
    }
  };

  void (async () => {
    try {
      const hadController = Boolean(navigator.serviceWorker.controller);
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => registration.unregister()),
      );

      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("mealscout-sw-") ||
                key.toLowerCase().includes("workbox"),
            )
            .map((key) => caches.delete(key)),
        );
      }

      if (hadController && !hasReset) {
        markReset();
        const url = new URL(window.location.href);
        url.searchParams.set("sw_reset", Date.now().toString());
        window.location.replace(url.toString());
      }
    } catch {
      // ignore
    }
  })();
}

createRoot(document.getElementById("root")!).render(
  <LocaleProvider>
    <App />
  </LocaleProvider>,
);

