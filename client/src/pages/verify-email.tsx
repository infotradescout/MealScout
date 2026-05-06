import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { MailCheck, RefreshCcw, PencilLine, LockKeyhole } from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { BackHeader } from "@/components/back-header";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { trackFunnelEvent } from "@/utils/funnelTelemetry";

type AccountType =
  | "diner"
  | "host"
  | "business"
  | "event_organizer"
  | "supplier"
  | "unknown";

const getSafePath = (candidate: string, fallback: string) => {
  const value = String(candidate || "").trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("://")) return fallback;
  return value;
};

const getSignupPath = (accountType: AccountType, businessType: string) => {
  if (accountType === "business") {
    if (businessType === "food_truck") {
      return "/truck-onboarding";
    }
    if (businessType === "bar") {
      return "/customer-signup?role=business&businessType=bar";
    }
    if (businessType === "caterer") {
      return "/customer-signup?role=business&businessType=caterer";
    }
    if (businessType === "private_chef") {
      return "/customer-signup?role=business&businessType=private_chef";
    }
    return "/customer-signup?role=business";
  }
  if (accountType === "host") return "/customer-signup?role=host";
  if (accountType === "event_organizer")
    return "/customer-signup?role=event_coordinator";
  if (accountType === "supplier") return "/customer-signup?role=supplier";
  return "/customer-signup";
};

export default function VerifyEmailPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const params = useMemo(
    () =>
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );

  const nextPath = getSafePath(params.get("next") || "/", "/");
  const source = String(params.get("source") || "signup").trim();
  const status = String(params.get("status") || "").trim();
  const accountType = (String(params.get("accountType") || "unknown").trim() ||
    "unknown") as AccountType;
  const businessType = String(params.get("businessType") || "").trim();
  const signupPath = getSignupPath(accountType, businessType);

  useEffect(() => {
    try {
      const savedEmail = window.sessionStorage.getItem(
        "mealscout:lastSignupEmail",
      );
      if (savedEmail) {
        setEmail(savedEmail);
      }
    } catch {
      // ignore storage access issues
    }

    trackFunnelEvent("funnel_activation_started", {
      page: "verify-email",
      stage: "verification_pending_view",
      source,
      accountType,
      businessType: businessType || null,
      nextPath,
    });
  }, [source, accountType, businessType, nextPath]);

  const resendVerification = async () => {
    if (!email) {
      toast({
        title: "Email required",
        description: "Enter the signup email below and retry.",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      await apiRequest("POST", "/api/auth/resend-verification", {
        email,
        next: nextPath,
      });
      toast({
        title: "Verification sent",
        description:
          "If that account exists and still needs verification, a fresh link is on the way.",
      });
    } catch (error: any) {
      toast({
        title: "Unable to resend",
        description: error?.message || "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title="Verify Your Email - MealScout"
        description="Confirm your email to activate your MealScout account."
        canonicalUrl="https://www.mealscout.us/verify-email"
        noIndex={true}
      />
      <BackHeader
        title="Verify Email"
        fallbackHref={signupPath}
        icon={MailCheck}
      />

      <main className="max-w-xl mx-auto px-4 sm:px-6 py-8">
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)] flex items-center justify-center shrink-0">
              <MailCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">
                Check your inbox
              </h1>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                We sent a link to confirm your email.
              </p>
              {email ? (
                <p className="mt-2 text-sm text-[color:var(--text-primary)] font-medium">
                  {email}
                </p>
              ) : null}
              {status === "expired" || status === "invalid" ? (
                <p className="mt-3 rounded-xl border border-[color:var(--status-warning)]/30 bg-[color:var(--status-warning)]/10 px-3 py-2 text-sm text-[color:var(--status-warning)]">
                  {status === "expired"
                    ? "That verification link expired. Send yourself a fresh one."
                    : "That verification link is invalid or has already been replaced. Send yourself a fresh one."}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {!email ? (
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email address"
                className="w-full rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--action-primary)]"
                autoComplete="email"
                data-testid="input-verify-email-resend"
              />
            ) : null}
            <button
              onClick={resendVerification}
              disabled={sending}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium bg-[color:var(--action-primary)] text-[color:var(--action-primary-text)] hover:bg-[color:var(--action-hover)] disabled:opacity-60"
              data-testid="button-verify-email-resend"
            >
              <RefreshCcw className="w-4 h-4" />
              {sending
                ? "Sending verification link..."
                : "Resend verification email"}
            </button>

            <div
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-center text-sm font-medium text-[color:var(--text-secondary)]"
              data-testid="message-verify-email-required"
            >
              <LockKeyhole className="h-4 w-4 shrink-0" />
              Open the email link before signing in.
            </div>

            <Link href={signupPath}>
              <a
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 font-medium border border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] hover:bg-[var(--bg-surface-muted)]"
                data-testid="link-verify-email-change"
              >
                <PencilLine className="w-4 h-4" />
                Use a different email
              </a>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
