import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, X } from "lucide-react";
import {
  getInAppBrowserInfo,
  isAndroidDevice,
  isIOSDevice,
  openCurrentUrlInExternalBrowser,
} from "@/lib/inAppBrowser";

const DISMISS_KEY = "mealscout:in_app_browser_notice:dismissed";

export function InAppBrowserNotice() {
  const info = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : getInAppBrowserInfo(window.navigator.userAgent || ""),
    [],
  );
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!info?.isMetaBrowser || dismissed) return null;

  const ua =
    typeof window === "undefined" ? "" : window.navigator.userAgent || "";
  const platformHint = isIOSDevice(ua)
    ? "Tap the menu, then Open in Browser."
    : isAndroidDevice(ua)
      ? "Open in Chrome for smoother login, GPS, and checkout."
      : "Open in your browser for smoother login, GPS, and checkout.";

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[1400] mx-auto max-w-md rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 shadow-clean-lg">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[color:var(--text-primary)]">
            {info.appName} browser detected
          </div>
          <div className="mt-0.5 text-xs leading-5 text-[color:var(--text-secondary)]">
            {platformHint}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openCurrentUrlInExternalBrowser}
              className="inline-flex h-8 items-center gap-1 rounded-lg bg-[color:var(--accent-text)] px-3 text-xs font-semibold text-black"
              data-testid="button-open-external-browser"
            >
              Open
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[color:var(--border-subtle)] px-3 text-xs font-semibold text-[color:var(--text-primary)]"
              data-testid="button-copy-current-link"
            >
              {copied ? "Copied" : "Copy link"}
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss browser notice"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--text-secondary)] hover:bg-[var(--bg-surface-muted)] hover:text-[color:var(--text-primary)]"
          data-testid="button-dismiss-in-app-browser-notice"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
