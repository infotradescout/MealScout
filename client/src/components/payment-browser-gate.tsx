import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildExternalBrowserUrl,
  detectInAppBrowser,
} from "@/lib/inAppBrowser";

type PaymentBrowserGateProps = {
  currentUrl?: string;
  reason?: string;
  onContinueAnyway?: () => void;
  compact?: boolean;
  allowContinueAnyway?: boolean;
};

export default function PaymentBrowserGate({
  currentUrl,
  reason,
  onContinueAnyway,
  compact = false,
  allowContinueAnyway = false,
}: PaymentBrowserGateProps) {
  const [copied, setCopied] = useState(false);
  const detection = useMemo(() => detectInAppBrowser(), []);
  const resolvedUrl =
    currentUrl || (typeof window !== "undefined" ? window.location.href : "");

  const openInBrowser = () => {
    const next = buildExternalBrowserUrl(resolvedUrl);
    if (typeof window !== "undefined") {
      window.location.href = next;
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(resolvedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className={compact ? "rounded-xl" : "rounded-2xl"}>
      <CardContent className={compact ? "p-4 space-y-3" : "p-5 space-y-4"}>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">
            Open in your browser to finish payment
          </p>
          <p className="text-xs text-[color:var(--text-secondary)]">
            Facebook and Messenger can block parts of checkout. Open this page
            in Chrome or Safari so your payment can complete safely.
          </p>
          {reason ? (
            <p className="text-xs text-[color:var(--text-muted)]">{reason}</p>
          ) : null}
          {detection.platform === "ios" ? (
            <p className="text-xs text-[color:var(--text-muted)]">
              In Facebook or Messenger, tap the menu and choose Open in Browser.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={openInBrowser} className="flex-1">
            Open in browser
          </Button>
          <Button type="button" variant="outline" onClick={copyLink} className="flex-1">
            {copied ? "Link copied" : "Copy link"}
          </Button>
        </div>
        {allowContinueAnyway && onContinueAnyway ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={onContinueAnyway}
          >
            Continue anyway
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

