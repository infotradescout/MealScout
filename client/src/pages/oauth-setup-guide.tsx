import type { ComponentType, ReactNode } from "react";
import { Settings, CheckCircle, AlertCircle, ExternalLink, ShieldCheck } from "lucide-react";
import { BackHeader } from "@/components/back-header";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";

function SectionBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  const Icon = icon;
  return (
    <section className="rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur p-6 shadow-clean-lg">
      <div className="mb-5 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--action-primary)]/30 bg-[color:var(--action-primary)]/15">
          <Icon className="h-5 w-5 text-[color:var(--action-primary)]" />
        </span>
        <h2 className="text-xl font-black tracking-tight text-[color:var(--text-primary)]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function InfoCard({
  title,
  children,
  variant = "neutral",
}: {
  title: string;
  children: ReactNode;
  variant?: "neutral" | "warn" | "danger" | "success";
}) {
  const styles: Record<string, string> = {
    neutral: "border-[color:var(--border-subtle)] bg-[var(--bg-surface)] text-[color:var(--text-secondary)]",
    warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    danger: "border-[color:var(--status-error)]/40 bg-[color:var(--status-error)]/10 text-[color:var(--status-error)]",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  };

  return (
    <div className={`rounded-xl border px-4 py-3 ${styles[variant]}`}>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="text-xs leading-relaxed">{children}</div>
    </div>
  );
}

function CodeLine({ children }: { children: React.ReactNode }) {
  return (
    <code className="block rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[color:var(--text-primary)] break-all">
      {children}
    </code>
  );
}

export default function OAuthSetupGuide() {
  const baseUrl = "https://mealscout.us";

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] relative overflow-hidden">
      <SEOHead
        title="OAuth Setup Guide - MealScout"
        description="Configuration guide for Google and Facebook OAuth authentication"
        noIndex={true}
      />
      <h1 className="sr-only">MealScout OAuth Setup Guide</h1>

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10rem] right-[-8rem] h-[26rem] w-[26rem] rounded-full bg-[color:var(--action-primary)]/15 blur-3xl" />
        <div className="absolute bottom-[-10rem] left-[-8rem] h-[24rem] w-[24rem] rounded-full bg-[color:var(--accent)]/20 blur-3xl" />
      </div>

      <BackHeader
        title="OAuth Configuration Guide"
        fallbackHref="/admin/dashboard"
        icon={Settings}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-6 space-y-6">
        <SectionBlock title="Google OAuth Configuration" icon={ShieldCheck}>
          <div className="space-y-4">
            <InfoCard title="1) Google Cloud Console" variant="neutral">
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)]"
              >
                Open Google Cloud Console <ExternalLink className="h-3 w-3" />
              </a>
            </InfoCard>

            <InfoCard title="2) OAuth Consent Screen" variant="neutral">
              <p>User Type: External</p>
              <p>App Name: MealScout</p>
              <p>User Support Email: support@mealscout.us</p>
              <p>Developer Contact: support@mealscout.us</p>
            </InfoCard>

            <InfoCard title="3) App Domain" variant="neutral">
              <p className="mb-2">Authorized Domain:</p>
              <CodeLine>mealscout.us</CodeLine>
            </InfoCard>

            <InfoCard title="4) Required App Links" variant="warn">
              <p className="mb-2">Privacy Policy URL:</p>
              <CodeLine>{baseUrl}/privacy-policy</CodeLine>
              <p className="mt-3 mb-2">Terms of Service URL:</p>
              <CodeLine>{baseUrl}/terms-of-service</CodeLine>
            </InfoCard>

            <InfoCard title="5) OAuth Client Credentials" variant="neutral">
              <p className="mb-2">Authorized JavaScript Origin:</p>
              <CodeLine>{baseUrl}</CodeLine>
              <p className="mt-3 mb-2">Authorized Redirect URIs:</p>
              <CodeLine>{baseUrl}/api/auth/google/customer/callback</CodeLine>
              <CodeLine>{baseUrl}/api/auth/google/restaurant/callback</CodeLine>
            </InfoCard>

            <InfoCard title="6) Scopes" variant="neutral">
              <p>userinfo.email</p>
              <p>userinfo.profile</p>
            </InfoCard>

            <InfoCard title="Environment Variables" variant="warn">
              <p className="mb-2">Add these to your production secrets:</p>
              <CodeLine>GOOGLE_CLIENT_ID=your_client_id_here</CodeLine>
              <CodeLine>GOOGLE_CLIENT_SECRET=your_client_secret_here</CodeLine>
            </InfoCard>
          </div>
        </SectionBlock>

        <SectionBlock title="Facebook OAuth Configuration" icon={Settings}>
          <div className="space-y-4">
            <InfoCard title="1) Facebook Developers Portal" variant="neutral">
              <a
                href="https://developers.facebook.com/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)]"
              >
                Open Facebook for Developers <ExternalLink className="h-3 w-3" />
              </a>
            </InfoCard>

            <InfoCard title="2) App Basic Settings" variant="neutral">
              <p className="mb-2">App Name:</p>
              <CodeLine>MealScout</CodeLine>
              <p className="mt-3 mb-2">App Domain:</p>
              <CodeLine>mealscout.us</CodeLine>
            </InfoCard>

            <InfoCard title="3) Required Policy URLs" variant="danger">
              <p className="mb-2">Privacy Policy URL:</p>
              <CodeLine>{baseUrl}/privacy-policy</CodeLine>
              <p className="mt-3 mb-2">User Data Deletion URL:</p>
              <CodeLine>{baseUrl}/data-deletion</CodeLine>
              <p className="mt-2">Facebook rejects apps missing these URLs.</p>
            </InfoCard>

            <InfoCard title="4) Terms of Service URL" variant="neutral">
              <CodeLine>{baseUrl}/terms-of-service</CodeLine>
            </InfoCard>

            <InfoCard title="5) Facebook Login Redirect URI" variant="neutral">
              <p className="mb-2">Products -&gt; Facebook Login -&gt; Settings:</p>
              <CodeLine>{baseUrl}/api/auth/facebook/callback</CodeLine>
            </InfoCard>

            <InfoCard title="6) Permissions and App Mode" variant="neutral">
              <p>Required permissions: `email`, `public_profile`.</p>
              <p>After config, switch app from Development to Live mode.</p>
            </InfoCard>

            <InfoCard title="Common Errors" variant="danger">
              <p>Privacy Policy URL is required -&gt; set `{baseUrl}/privacy-policy`.</p>
              <p>User Data Deletion URL missing -&gt; set `{baseUrl}/data-deletion`.</p>
              <p>OAuth Redirect URI mismatch -&gt; add exact callback URL.</p>
              <p>Cannot load URL -&gt; ensure HTTPS and public accessibility.</p>
            </InfoCard>

            <InfoCard title="Environment Variables" variant="warn">
              <p className="mb-2">Add these to your production secrets:</p>
              <CodeLine>FACEBOOK_APP_ID=your_app_id_here</CodeLine>
              <CodeLine>FACEBOOK_APP_SECRET=your_app_secret_here</CodeLine>
            </InfoCard>
          </div>
        </SectionBlock>

        <SectionBlock title="Verification Checklist" icon={CheckCircle}>
          <div className="space-y-4">
            <InfoCard title="Pre-Launch Checks" variant="success">
              <p>- Privacy policy and terms URLs load over HTTPS.</p>
              <p>- OAuth redirect URIs match exactly.</p>
              <p>- Env vars are set in deployment secrets.</p>
              <p>- Facebook app is Live.</p>
              <p>- Google consent screen is configured.</p>
            </InfoCard>

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                onClick={() => window.open(baseUrl + "/privacy-policy", "_blank")}
                className="w-full rounded-xl"
              >
                Test Privacy Policy
              </Button>
              <Button
                variant="outline"
                onClick={() => window.open(baseUrl + "/data-deletion", "_blank")}
                className="w-full rounded-xl"
              >
                Test Data Deletion
              </Button>
            </div>

            <div className="inline-flex items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <AlertCircle className="h-4 w-4" />
              Use exact domain and callback strings; small URI mismatches cause OAuth failure.
            </div>
          </div>
        </SectionBlock>
      </div>
    </div>
  );
}




