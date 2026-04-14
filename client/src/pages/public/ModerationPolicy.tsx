import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEOHead } from "@/components/seo-head";

export default function ModerationPolicy() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 space-y-6">
      <SEOHead
        title="MealScout Moderation Policy"
        description="How MealScout handles flags, moderation decisions, appeals, and reporter reputation."
        canonicalUrl="https://www.mealscout.us/moderation-policy"
      />

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          MealScout Moderation and Community Trust Policy
        </h1>
        <p className="text-sm text-muted-foreground">Last updated: April 14, 2026</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>
            MealScout is committed to a trustworthy community where users can share honest recommendations.
            This policy explains how flags are reviewed and how decisions are made.
          </p>
          <p>
            We are infrastructure, not arbitrators. We enforce policy compliance for content on our platform,
            but we do not resolve business disputes or issue refunds between parties.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What Triggers Moderation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h2 className="font-semibold mb-2">Recommendation Flags</h2>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>Spam, duplicates, or promotional abuse</li>
              <li>Inappropriate, hateful, or threatening language</li>
              <li>Misleading or fake claims</li>
              <li>Off-topic content unrelated to the listing</li>
            </ul>
          </div>
          <div>
            <h2 className="font-semibold mb-2">Profile Content Flags</h2>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>False business information (hours, address, contact details)</li>
              <li>Misleading or policy-violating profile content</li>
              <li>Abusive or inappropriate text or media</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Moderation Flow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>1. A user files a report with optional evidence.</p>
          <p>2. A moderator reviews the report against policy standards.</p>
          <p>3. Outcome is recorded as valid, invalid, or partial.</p>
          <p>4. Parties can appeal within the allowed appeal window.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reporter Reputation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Starting score: 100 (minimum 10).</p>
          <p>Valid report: +5.</p>
          <p>Invalid report: -10.</p>
          <p>Partial report: +2.</p>
          <p>
            Reputation helps anti-brigading and influences how quickly and strongly reports are weighted.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appeals and Abuse Prevention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Appeals are reviewed by a different moderator where possible.</p>
          <p>Rate limits and duplicate-report protections are enforced to reduce abuse.</p>
          <p>
            Coordinated false reporting, harassment, or manipulation attempts may result in moderation actions
            on the reporting account.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
