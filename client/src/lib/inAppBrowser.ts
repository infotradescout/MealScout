export type InAppBrowserDetection = {
  isInAppBrowser: boolean;
  provider:
    | "facebook"
    | "messenger"
    | "instagram"
    | "tiktok"
    | "twitter"
    | "unknown"
    | null;
  platform: "ios" | "android" | "desktop" | "unknown";
  canUseAndroidIntent: boolean;
};

const getUserAgent = () =>
  typeof navigator !== "undefined" ? navigator.userAgent || "" : "";

const getPlatform = (ua: string): InAppBrowserDetection["platform"] => {
  const normalized = ua.toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("android")) return "android";
  if (
    normalized.includes("iphone") ||
    normalized.includes("ipad") ||
    normalized.includes("ipod") ||
    normalized.includes("ios")
  ) {
    return "ios";
  }
  if (
    normalized.includes("windows") ||
    normalized.includes("macintosh") ||
    normalized.includes("linux")
  ) {
    return "desktop";
  }
  return "unknown";
};

const detectProvider = (ua: string): InAppBrowserDetection["provider"] => {
  const normalized = ua.toLowerCase();
  if (!normalized) return null;

  if (
    normalized.includes("messenger") ||
    normalized.includes("fban/messenger") ||
    normalized.includes("fb_iab/messenger")
  ) {
    return "messenger";
  }
  if (
    normalized.includes("fban") ||
    normalized.includes("fbav") ||
    normalized.includes("fb_iab")
  ) {
    return "facebook";
  }
  if (normalized.includes("instagram")) return "instagram";
  if (normalized.includes("tiktok")) return "tiktok";
  if (
    normalized.includes("twitter") ||
    normalized.includes("x-webview") ||
    normalized.includes("twitter for")
  ) {
    return "twitter";
  }

  // Treat explicit Android WebView signatures as unknown in-app browsers.
  // Do not use generic "version/" because Safari includes it and should not
  // be blocked from checkout.
  const hasAndroidWebView = normalized.includes("; wv)");
  if (hasAndroidWebView) return "unknown";
  return null;
};

export function detectInAppBrowser(): InAppBrowserDetection {
  const ua = getUserAgent();
  const provider = detectProvider(ua);
  const platform = getPlatform(ua);
  const isInAppBrowser = provider !== null;

  return {
    isInAppBrowser,
    provider,
    platform,
    canUseAndroidIntent: isInAppBrowser && platform === "android",
  };
}

export function isPaymentHostileBrowser() {
  const detection = detectInAppBrowser();
  return (
    detection.isInAppBrowser &&
    ["facebook", "messenger", "instagram", "tiktok", "twitter", "unknown"].includes(
      detection.provider || "unknown",
    )
  );
}

export function buildExternalBrowserUrl(currentUrl: string) {
  const detection = detectInAppBrowser();
  const safeUrl = currentUrl || (typeof window !== "undefined" ? window.location.href : "");

  if (detection.canUseAndroidIntent) {
    const withoutScheme = safeUrl.replace(/^https?:\/\//i, "");
    return `intent://${withoutScheme}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(
      safeUrl,
    )};end`;
  }

  return safeUrl;
}
