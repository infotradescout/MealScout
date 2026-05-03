const DEFAULT_META_PIXEL_ID = "977290868006898";
const META_PIXEL_SCRIPT_ID = "meta-pixel-script";
const META_PIXEL_SCRIPT_SRC = "https://connect.facebook.net/en_US/fbevents.js";

type MetaPixelFunction = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  push?: (...args: unknown[]) => void;
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: MetaPixelFunction;
    _fbq?: MetaPixelFunction;
  }
}

let initializedPixelId = "";
let lastTrackedPath = "";

const getMetaPixelId = () =>
  String(import.meta.env.VITE_META_PIXEL_ID || DEFAULT_META_PIXEL_ID).trim();

const isTruthyEnv = (value: unknown) =>
  ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());

const shouldEnableMetaPixel = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  if (isTruthyEnv(import.meta.env.VITE_DISABLE_META_PIXEL)) {
    return false;
  }

  const host = window.location.hostname.toLowerCase();
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (isLocalhost && !isTruthyEnv(import.meta.env.VITE_ENABLE_META_PIXEL_DEV)) {
    return false;
  }

  return Boolean(getMetaPixelId());
};

const currentPath = () => {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
};

const installFbqStub = () => {
  if (typeof window === "undefined") return null;
  if (window.fbq) return window.fbq;

  let fbq: MetaPixelFunction;
  fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
    } else {
      fbq.queue?.push(args);
    }
  }) as MetaPixelFunction;

  if (!window._fbq) {
    window._fbq = fbq;
  }

  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  window.fbq = fbq;
  return fbq;
};

const ensureMetaPixelScript = () => {
  if (document.getElementById(META_PIXEL_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = META_PIXEL_SCRIPT_ID;
  script.async = true;
  script.src = META_PIXEL_SCRIPT_SRC;

  const firstScript = document.getElementsByTagName("script")[0];
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }
};

export const installMetaPixel = () => {
  if (!shouldEnableMetaPixel()) return;

  const pixelId = getMetaPixelId();
  const fbq = installFbqStub();
  if (!fbq) return;

  ensureMetaPixelScript();

  if (initializedPixelId !== pixelId) {
    fbq("init", pixelId);
    initializedPixelId = pixelId;
  }

  trackMetaPageView();
};

export const trackMetaPageView = () => {
  if (!initializedPixelId || typeof window === "undefined" || !window.fbq) {
    return;
  }

  const path = currentPath();
  if (path === lastTrackedPath) return;

  lastTrackedPath = path;
  window.fbq("track", "PageView");
};

export const trackMetaEvent = (
  eventName: string,
  properties?: Record<string, unknown>,
) => {
  if (!initializedPixelId || !eventName || !window.fbq) return;
  window.fbq("track", eventName, properties || {});
};
