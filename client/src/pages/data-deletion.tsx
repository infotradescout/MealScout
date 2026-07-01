import type { ReactNode } from "react";
import { Trash2, Calendar, Mail, MessageCircle, ShieldCheck, AlertTriangle } from "lucide-react";
import { BackHeader } from "@/components/back-header";
import { Button } from "@/components/ui/button";
import { SEOHead } from "@/components/seo-head";

function Panel({
  title,
  children,
  tone = "neutral",
}: {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "warn" | "danger" | "success";
}) {
  const toneClass: Record<string, string> = {
    neutral: "border-[color:var(--border-subtle)] bg-[var(--bg-surface)] text-[color:var(--text-secondary)]",
    warn: "border-amber-500/35 bg-amber-500/10 text-amber-200",
    danger: "border-[color:var(--status-error)]/35 bg-[color:var(--status-error)]/10 text-[color:var(--status-error)]",
    success: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
  };

  return (
    <section className={`rounded-2xl border p-5 ${toneClass[tone]}`}>
      <h3 className="text-base font-bold mb-3">{title}</h3>
      <div className="text-sm leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return <p>- {children}</p>;
}

export default function DataDeletion() {
  return (
    <div className="min-h-screen bg-[var(--bg-layered)] relative overflow-hidden">
      <SEOHead
        title="Data Deletion - MealScout | Delete Your Account & Data"
        description="Learn how to request deletion of your personal data from MealScout. Step-by-step instructions for account deletion and data removal in compliance with privacy regulations."
        keywords="data deletion, account deletion, delete account, remove data, privacy rights"
        canonicalUrl="https://www.mealscout.us/data-deletion"
      />

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10rem] right-[-8rem] h-[26rem] w-[26rem] rounded-full bg-[color:var(--action-primary)]/15 blur-3xl" />
        <div className="absolute bottom-[-10rem] left-[-8rem] h-[24rem] w-[24rem] rounded-full bg-[color:var(--accent)]/20 blur-3xl" />
      </div>

      <BackHeader
        title="Data Deletion Instructions"
        fallbackHref="/"
        icon={Trash2}
        rightActions={
          <div className="flex items-center gap-2 text-xs text-[color:var(--text-secondary)]">
            <Calendar className="w-3.5 h-3.5" />
            <span>Last updated: February 9, 2026</span>
          </div>
        }
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 py-6 space-y-5">
        <div className="rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur p-6 shadow-clean-lg">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[color:var(--action-primary)]/30 bg-[color:var(--action-primary)]/15 shrink-0">
              <Trash2 className="h-6 w-6 text-[color:var(--action-primary)]" />
            </span>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-[color:var(--text-primary)] mb-2">Delete Account & Data</h1>
              <p className="text-sm text-[color:var(--text-secondary)]">
                You can self-delete from your account settings or request manual deletion by email.
              </p>
            </div>
          </div>
        </div>

        <Panel title="Quick Account Deletion (Self-Service)" tone="neutral">
          <Bullet>Log in and go to `Profile` -&gt; `Settings`.</Bullet>
          <Bullet>Open `Account Management` and select `Delete Account`.</Bullet>
          <Bullet>Confirm with your account email.</Bullet>
          <Bullet>Deletion is permanent and cannot be undone.</Bullet>
        </Panel>

        <Panel title="Manual Deletion Request" tone="neutral">
          <p>If you cannot access your account, contact us directly:</p>
          <div className="grid gap-3 sm:grid-cols-2 mt-2">
            <Button
              variant="outline"
              onClick={() =>
                (window.location.href =
                  "mailto:privacy@mealscout.us?subject=Data Deletion Request")
              }
              className="rounded-xl"
              data-testid="button-email-deletion"
            >
              <Mail className="mr-2 h-4 w-4" />
              privacy@mealscout.us
            </Button>
            <Button
              variant="outline"
              onClick={() => (window.location.href = "/contact?subject=data-deletion")}
              className="rounded-xl"
              data-testid="button-contact-deletion"
            >
              <MessageCircle className="mr-2 h-4 w-4" />
              Use Contact Form
            </Button>
          </div>
        </Panel>

        <Panel title="Required Information in Request" tone="warn">
          <Bullet>Full name on the account.</Bullet>
          <Bullet>Registration email address.</Bullet>
          <Bullet>Phone number (if provided).</Bullet>
          <Bullet>Optional deletion reason.</Bullet>
          <Bullet>Any additional account identifiers.</Bullet>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Data We Delete" tone="danger">
            <Bullet>Profile information and photos.</Bullet>
            <Bullet>Email and contact details.</Bullet>
            <Bullet>Location data and preferences.</Bullet>
            <Bullet>Order history, favorites, reviews, and ratings.</Bullet>
            <Bullet>Stored payment references and communication records.</Bullet>
          </Panel>

          <Panel title="Data We May Retain" tone="neutral">
            <Bullet>Anonymous usage analytics.</Bullet>
            <Bullet>Financial records for legal/tax compliance.</Bullet>
            <Bullet>Fraud prevention and security records.</Bullet>
            <p className="text-xs mt-2 opacity-80">
              Retained records are minimized and held only as required by law or security policy.
            </p>
          </Panel>
        </div>

        <Panel title="Timeline" tone="success">
          <Bullet>Immediate: account access disabled.</Bullet>
          <Bullet>Within 7 days: personal data removed from active systems.</Bullet>
          <Bullet>Within 30 days: backup purge where legally permitted.</Bullet>
          <Bullet>Confirmation email sent when deletion completes.</Bullet>
        </Panel>

        <Panel title="Facebook Login Data" tone="neutral">
          <Bullet>MealScout removes Facebook-sourced profile data from our systems.</Bullet>
          <Bullet>MealScout access tokens are revoked from our side.</Bullet>
          <Bullet>Your Facebook account itself is not deleted.</Bullet>
          <Bullet>For full disconnect, also revoke MealScout in Facebook app permissions.</Bullet>
        </Panel>

        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>
            This process supports privacy rights frameworks including GDPR and CCPA. We handle requests promptly and transparently.
          </p>
        </div>

        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[color:var(--text-secondary)]">
          <p className="font-semibold text-[color:var(--text-primary)] mb-1 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[color:var(--action-primary)]" />
            Need help?
          </p>
          <p>Privacy: `privacy@mealscout.us`</p>
          <p>Support: `support@mealscout.us`</p>
        </div>
      </div>
    </div>
  );
}




