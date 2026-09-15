import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buildExternalBrowserUrl, detectInAppBrowser } from "@/lib/inAppBrowser";
import { copyPaymentLink } from "@/lib/paymentLinkCopy";

type PaymentBrowserGateProps = {
  currentUrl?: string;
  reason?: string;
  onContinueAnyway?: () => void;
  compact?: boolean;
  allowContinueAnyway?: boolean;
};

type CopyState = "idle" | "copying" | "copied" | "manual";

export default function PaymentBrowserGate({
  currentUrl,
  reason,
  onContinueAnyway,
  compact = false,
  allowContinueAnyway = false,
}: PaymentBrowserGateProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [openFailed, setOpenFailed] = useState(false);
  const detection = useMemo(() => detectInAppBrowser(), []);
  const resolvedUrl =
    currentUrl || (typeof window !== "undefined" ? window.location.href : "");
  const titleId = useId();
  const linkId = useId();
  const statusId = useId();
  const manualLinkRef = useRef<HTMLInputElement>(null);
  const copyAttemptRef = useRef(0);

  useEffect(() => {
    copyAttemptRef.current += 1;
    setCopyState("idle");
    setOpenFailed(false);
    return () => {
      // Ignore clipboard responses belonging to an old URL or unmounted gate.
      copyAttemptRef.current += 1;
    };
  }, [resolvedUrl]);

  useEffect(() => {
    if (copyState === "manual") {
      manualLinkRef.current?.focus();
      manualLinkRef.current?.select();
    }
  }, [copyState]);

  const openInBrowser = () => {
    if (!resolvedUrl || typeof window === "undefined") return;
    setOpenFailed(false);
    try {
      window.location.href = buildExternalBrowserUrl(resolvedUrl);
    } catch {
      setOpenFailed(true);
    }
  };

  const copyLink = async () => {
    const attempt = ++copyAttemptRef.current;
    setCopyState("copying");
    // Even reading clipboard can be denied by the embedding browser.
    let result: "copied" | "manual" = "manual";
    try {
      result = await copyPaymentLink(
        resolvedUrl,
        typeof navigator === "undefined" ? undefined : navigator.clipboard,
      );
    } catch {
      result = "manual";
    }
    if (attempt === copyAttemptRef.current) setCopyState(result);
  };

  return (
    <Card
      className={compact ? "min-w-0 rounded-xl" : "min-w-0 rounded-2xl"}
      role="region"
      aria-labelledby={titleId}
    >
      <CardContent className={compact ? "p-4 space-y-3" : "p-5 space-y-4"}>
        <div className="space-y-2">
          <h2 id={titleId} className="text-sm font-semibold text-[color:var(--text-primary)]">
            Open in your browser to finish payment
          </h2>
          <p className="text-sm text-[color:var(--text-secondary)]">
            This in-app browser can block parts of checkout. Open this page in
            Chrome or Safari to continue.
          </p>
          {reason ? <p className="text-xs text-[color:var(--text-muted)]">{reason}</p> : null}
          {detection.platform === "ios" ? (
            <p className="text-xs text-[color:var(--text-muted)]">
              Use the app's menu and choose Open in Browser. If that option is
              missing, copy the link and paste it into Safari.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={openInBrowser} disabled={!resolvedUrl} className="flex-1">
            Open in browser
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={copyLink}
            disabled={!resolvedUrl || copyState === "copying"}
            className="flex-1"
          >
            {copyState === "copying" ? "Copying link…" : copyState === "copied" ? "Link copied" : "Copy link"}
          </Button>
        </div>
        <p id={statusId} role="status" aria-live="polite" aria-atomic="true" className="text-xs text-[color:var(--text-secondary)]">
          {copyState === "manual"
            ? "Automatic copy is unavailable. Select and copy the checkout link below."
            : copyState === "copied"
              ? "Link copied. Paste it into Chrome or Safari."
              : openFailed
                ? "The app could not open the link. Copy it into Chrome or Safari instead."
                : "If this page stays inside the app, use its Open in Browser menu or copy the link."}
        </p>
        {copyState === "manual" ? (
          <div className="min-w-0 space-y-2">
            <label htmlFor={linkId} className="text-xs font-semibold">Checkout link</label>
            <Input
              ref={manualLinkRef}
              id={linkId}
              type="text"
              readOnly
              value={resolvedUrl}
              aria-describedby={statusId}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        ) : null}
        <p className="rounded-xl border border-[color:var(--border-subtle)] p-3 text-xs leading-relaxed text-[color:var(--text-muted)]">
          Switching browsers may require signing in again and reselecting items
          or slots. If you already tried to pay, check your order or booking
          status before trying again.
        </p>
        {allowContinueAnyway && onContinueAnyway ? (
          <Button type="button" variant="ghost" className="w-full" onClick={onContinueAnyway}>
            Continue anyway
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
