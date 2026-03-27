import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowDownToLine, ExternalLink, PlusSquare, Share2, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "mealscout:pwa_install_banner:dismissed_at";
const DISMISS_DAYS = 7;

function isIosDevice() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(ua);
}

function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  // Facebook/Messenger/Instagram in-app browsers commonly include these.
  return /FBAN|FBAV|FB_IAB|Instagram/i.test(ua);
}

function isStandaloneMode() {
  // iOS uses navigator.standalone; others use display-mode.
  const anyNav = navigator as any;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      anyNav.standalone,
  );
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  const ios = useMemo(() => (typeof window === "undefined" ? false : isIosDevice()), []);
  const inApp = useMemo(() => (typeof window === "undefined" ? false : isInAppBrowser()), []);
  const standalone = useMemo(
    () => (typeof window === "undefined" ? false : isStandaloneMode()),
    [],
  );

  const isDismissedRecently = () => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      const ts = Number(raw);
      if (!Number.isFinite(ts)) return false;
      const ms = DISMISS_DAYS * 24 * 60 * 60 * 1000;
      return Date.now() - ts < ms;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return;
      const ts = Number(raw);
      if (!Number.isFinite(ts)) return;
      const ms = DISMISS_DAYS * 24 * 60 * 60 * 1000;
      if (Date.now() - ts < ms) setDismissed(true);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      // Chrome/Edge on Android/Desktop.
      // IMPORTANT: Only suppress the browser prompt when we intend to show our own UI.
      // If the banner is dismissed (or we're already installed), let the browser handle install UX.
      if (isStandaloneMode()) return;
      if (isDismissedRecently()) return;
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // In iOS in-app browsers (FB/Messenger/IG), A2HS is commonly blocked.
  // Always show instructions there (even if previously dismissed) so users can open in Safari.
  const shouldShow =
    !standalone &&
    ((ios && inApp) || (!dismissed && (ios || Boolean(deferredPrompt))));
  if (!shouldShow) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const onInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => undefined);
    } finally {
      setDeferredPrompt(null);
      dismiss();
    }
  };

  const pillLabel = deferredPrompt
    ? "Install"
    : ios
      ? "Add to Home Screen"
      : "Install";

  const pillIcon = deferredPrompt ? (
    <ArrowDownToLine className="h-4 w-4" />
  ) : ios ? (
    <PlusSquare className="h-4 w-4" />
  ) : (
    <ArrowDownToLine className="h-4 w-4" />
  );

  const showInstallPill = Boolean(deferredPrompt) || ios;

  return (
    <>
      {showInstallPill && (
        <div className="fixed left-4 right-auto bottom-[calc(0.75rem+env(safe-area-inset-bottom)+4.5rem)] z-40 md:left-auto md:right-4 md:bottom-auto md:top-4">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2 shadow-clean-lg">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              onClick={() => {
                if (deferredPrompt) {
                  void onInstall();
                  return;
                }
                setOpen(true);
              }}
              data-testid="button-pwa-pill"
            >
              {pillIcon}
              <span className="ml-1 text-sm font-semibold">{pillLabel}</span>
            </Button>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss install prompt"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-[var(--bg-surface)] hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-full max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add MealScout to your Home Screen</DialogTitle>
            <DialogDescription>
              iPhone and iPad install via Safari: Share, then Add to Home Screen.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm text-foreground">
            {inApp ? (
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3">
                <div className="font-semibold">You're in an in-app browser</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Facebook/Messenger browsers usually block install. Open this page in Safari first.
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                <Share2 className="h-3 w-3" />
                Share
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                <PlusSquare className="h-3 w-3" />
                Add to Home Screen
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                try {
                  navigator.clipboard?.writeText(window.location.href);
                } catch {
                  // ignore
                }
              }}
            >
              Copy link
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
              }}
            >
              Done
            </Button>
            {inApp && (
              <Button
                variant="ghost"
                onClick={() => {
                  // Can't force-open Safari; this is a hint action only.
                  window.open(window.location.href, "_blank", "noopener,noreferrer");
                }}
              >
                Open in browser <ExternalLink className="ml-1 h-4 w-4" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
