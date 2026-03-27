import { useMemo } from "react";
import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { BackHeader } from "@/components/back-header";
import Navigation from "@/components/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, PlusSquare, Share2, Smartphone, Monitor, Shield } from "lucide-react";

function isIos() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/i.test(ua);
}

function isAndroid() {
  const ua = navigator.userAgent || "";
  return /Android/i.test(ua);
}

function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|FB_IAB|Instagram|Messenger/i.test(ua);
}

function isStandalone() {
  const anyNav = navigator as any;
  return Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches || anyNav.standalone);
}

export default function InstallPage() {
  const ios = useMemo(() => (typeof window === "undefined" ? false : isIos()), []);
  const android = useMemo(() => (typeof window === "undefined" ? false : isAndroid()), []);
  const inApp = useMemo(() => (typeof window === "undefined" ? false : isInAppBrowser()), []);
  const standalone = useMemo(() => (typeof window === "undefined" ? false : isStandalone()), []);

  return (
    <div className="max-w-md lg:max-w-3xl mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
      <SEOHead
        title="Install MealScout"
        description="Install MealScout for faster access to food trucks, local deals, and parking pass availability."
        keywords="install mealscout, add to home screen, pwa"
        canonicalUrl="https://www.mealscout.us/install"
      />

      <BackHeader title="Install" fallbackHref="/" />

      <div className="px-4 sm:px-6 py-6 space-y-4">
        {standalone && (
          <Card className="border border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-[color:var(--status-success)] mt-0.5" />
                <div>
                  <div className="font-semibold text-foreground">Already installed</div>
                  <div className="text-sm text-muted-foreground">
                    You're running MealScout as an app.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {inApp && (
          <Card className="border border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
            <CardContent className="p-4 space-y-2">
              <div className="font-semibold text-foreground">In-app browser detected</div>
              <div className="text-sm text-muted-foreground">
                Facebook and Messenger browsers often block installing web apps. Open this page in your
                device browser first (Safari on iPhone, Chrome on Android).
              </div>
              <Button
                variant="outline"
                onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
              >
                Open in browser <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="border border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              {ios ? <Smartphone className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
              <h1 className="text-lg font-bold text-foreground">Install MealScout</h1>
            </div>

            {ios ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  On iPhone and iPad, install happens through Safari.
                </p>
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
                <ol className="list-decimal list-inside text-sm text-foreground space-y-1">
                  <li>Open this site in Safari.</li>
                  <li>Tap the Share button.</li>
                  <li>Tap Add to Home Screen.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  On Android and Windows, Chrome usually shows an install option in the menu or address bar.
                </p>
                <ol className="list-decimal list-inside text-sm text-foreground space-y-1">
                  <li>Open the Chrome menu (three dots).</li>
                  <li>Tap Install app (or Add to Home screen).</li>
                </ol>
                {!android && (
                  <p className="text-xs text-muted-foreground">
                    If you don't see it: your browser may hide install until you visit a couple pages.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean">
          <CardContent className="p-4 space-y-2">
            <div className="font-semibold text-foreground">Quick link</div>
            <div className="text-sm text-muted-foreground">
              If you're sharing this with someone else, send them this page.
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  try {
                    navigator.clipboard?.writeText("https://www.mealscout.us/install");
                  } catch {
                    // ignore
                  }
                }}
              >
                Copy install link
              </Button>
              <Link href="/">
                <Button>Back to app</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Navigation />
    </div>
  );
}
