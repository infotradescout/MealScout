export function getUserAgent(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export function isInAppBrowser(ua = getUserAgent()): boolean {
  return getInAppBrowserInfo(ua).isInAppBrowser;
}

export type InAppBrowserInfo = {
  isInAppBrowser: boolean;
  isMetaBrowser: boolean;
  isFacebookBrowser: boolean;
  isMessengerBrowser: boolean;
  isInstagramBrowser: boolean;
  appName: "Facebook" | "Messenger" | "Instagram" | "in-app browser" | null;
};

export function getInAppBrowserInfo(ua = getUserAgent()): InAppBrowserInfo {
  const isFacebookBrowser =
    /FBAN|FBAV|FBIOS|FB4A|FB_IAB|FBSS|FBCR|FBDV|FBMD/i.test(ua);
  const isMessengerBrowser = /Messenger|FBMSGR|FB_IAB\/Messenger/i.test(ua);
  const isInstagramBrowser = /Instagram/i.test(ua);
  const isMetaBrowser =
    isFacebookBrowser || isMessengerBrowser || isInstagramBrowser;
  const isInAppBrowser =
    isMetaBrowser || /Line\/|Twitter|TikTok|Snapchat|Pinterest/i.test(ua);

  return {
    isInAppBrowser,
    isMetaBrowser,
    isFacebookBrowser,
    isMessengerBrowser,
    isInstagramBrowser,
    appName: isMessengerBrowser
      ? "Messenger"
      : isFacebookBrowser
        ? "Facebook"
        : isInstagramBrowser
          ? "Instagram"
          : isInAppBrowser
            ? "in-app browser"
            : null,
  };
}

export function isMetaInAppBrowser(ua = getUserAgent()): boolean {
  return getInAppBrowserInfo(ua).isMetaBrowser;
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
