export function getUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export function isInAppBrowser(ua = getUserAgent()): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Messenger/i.test(ua);
}

export function isIOSDevice(ua = getUserAgent()): boolean {
  return /iPad|iPhone|iPod/i.test(ua);
}

export function isAndroidDevice(ua = getUserAgent()): boolean {
  return /Android/i.test(ua);
}

export function getShareableCurrentUrl(): string {
  if (typeof window === "undefined") return "";
  return window.location.href;
}

export function buildAndroidChromeIntentUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathWithQuery = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `intent://${parsed.host}${pathWithQuery}#Intent;scheme=${parsed.protocol.replace(":", "")};package=com.android.chrome;end`;
  } catch {
    return null;
  }
}

export function openCurrentUrlInExternalBrowser(): void {
  if (typeof window === "undefined") return;
  const url = getShareableCurrentUrl();
  const ua = getUserAgent();

  if (isAndroidDevice(ua)) {
    const intentUrl = buildAndroidChromeIntentUrl(url);
    if (intentUrl) {
      window.location.href = intentUrl;
      return;
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
}
