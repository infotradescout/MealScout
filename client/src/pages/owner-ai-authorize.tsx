import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";

import { SEOHead } from "@/components/seo-head";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";

type SocialConnection = {
  platform: "facebook" | "instagram" | "x";
  connected: boolean;
  displayName?: string | null;
};

type OAuthBusiness = {
  id: string;
  name: string;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  socialConnections: SocialConnection[];
};

type AuthorizationPreparation = {
  request: Record<string, string | undefined>;
  client: {
    clientId: string;
    clientName: string;
    clientUri?: string | null;
    registrationKind: "client_metadata_document" | "dynamic";
  };
  scopes: string[];
  businesses: OAuthBusiness[];
};

const platformLabel = (platform: SocialConnection["platform"]) =>
  platform === "x" ? "X" : platform[0].toUpperCase() + platform.slice(1);

const scopeLabel: Record<string, string> = {
  "owner_ai:context": "Read this business's current MealScout context",
  "owner_ai:drafts:create": "Prepare changes and social previews as drafts",
  "owner_ai:drafts:read": "Check only drafts created by this AI connection",
  "owner_ai:drafts:approve":
    "After you approve an exact revision in chat, apply it and publish to linked socials",
};

async function fetchPreparation(query: string) {
  const response = await fetch(
    `/api/owner-ai/oauth/authorize/prepare?${query}`,
    { credentials: "include" },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body.error_description || body.error || "This AI connection request is invalid.",
    );
  }
  return body as AuthorizationPreparation;
}

export default function OwnerAiAuthorizePage() {
  const search = useSearch();
  const oauthQuery = useMemo(() => {
    const source = new URLSearchParams(search);
    const selected = new URLSearchParams();
    for (const key of [
      "response_type",
      "client_id",
      "redirect_uri",
      "code_challenge",
      "code_challenge_method",
      "scope",
      "state",
      "resource",
    ]) {
      const value = source.get(key);
      if (value) selected.set(key, value);
    }
    return selected.toString();
  }, [search]);
  const [selectedBusinessId, setSelectedBusinessId] = useState("");

  const preparationQuery = useQuery<AuthorizationPreparation>({
    queryKey: ["owner-ai-oauth-authorization", oauthQuery],
    queryFn: () => fetchPreparation(oauthQuery),
    enabled: Boolean(oauthQuery),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const preparation = preparationQuery.data;
  const effectiveBusinessId =
    selectedBusinessId || preparation?.businesses[0]?.id || "";
  const selectedBusiness = preparation?.businesses.find(
    (business) => business.id === effectiveBusinessId,
  );
  const connectedSocials =
    selectedBusiness?.socialConnections.filter((connection) => connection.connected) || [];
  const returnPath = `/owner-ai/authorize?${oauthQuery}`;

  const authorizeMutation = useMutation({
    mutationFn: async () => {
      const payload = Object.fromEntries(new URLSearchParams(oauthQuery));
      const response = await apiRequest(
        "POST",
        "/api/owner-ai/oauth/authorize",
        { ...payload, restaurant_id: effectiveBusinessId },
      );
      return response.json() as Promise<{ redirectTo: string }>;
    },
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  const denyMutation = useMutation({
    mutationFn: async () => {
      const payload = Object.fromEntries(new URLSearchParams(oauthQuery));
      const response = await apiRequest(
        "POST",
        "/api/owner-ai/oauth/authorize/deny",
        payload,
      );
      return response.json() as Promise<{ redirectTo: string }>;
    },
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  if (preparationQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
        <Loader2 className="h-7 w-7 animate-spin text-orange-600" />
        <span className="ml-3 text-sm text-stone-700">
          Verifying the AI connection…
        </span>
      </main>
    );
  }

  if (preparationQuery.error || !preparation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
        <Card className="w-full max-w-xl border-red-200">
          <CardHeader>
            <CardTitle>AI connection could not be verified</CardTitle>
            <CardDescription>
              {preparationQuery.error instanceof Error
                ? preparationQuery.error.message
                : "Return to your AI and start the MealScout sign-in again."}
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 sm:py-12">
      <SEOHead
        title="Sign in to your AI with MealScout"
        description="Authorize an AI for one MealScout business with exact-revision owner consent before applying changes or publishing."
        noIndex
      />
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-600 text-white">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-stone-950">
            Sign in to your AI with MealScout
          </h1>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {preparation.client.clientName} is asking to prepare owner-review
            drafts and carry out revisions you explicitly approve for one
            business you own.
          </p>
        </div>

        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Approval is granted one exact revision at a time</AlertTitle>
          <AlertDescription>
            The AI can read the selected business and prepare a complete
            preview. MealScout lets it apply and publish only after it shows
            you that immutable revision and you explicitly approve it in your
            chat. Only social accounts connected below are eligible.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-orange-600" />
                  {preparation.client.clientName}
                </CardTitle>
                <CardDescription className="mt-1">
                  {preparation.client.registrationKind ===
                  "client_metadata_document"
                    ? "Verified tool client metadata"
                    : "Dynamically registered tool client"}
                </CardDescription>
              </div>
              <Badge variant="outline">Per-revision consent</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {preparation.scopes.map((scope) => (
              <div key={scope} className="flex gap-3 text-sm text-stone-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{scopeLabel[scope] || scope}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Choose the MealScout business</CardTitle>
            <CardDescription>
              The connection is permanently scoped to this owner-business pair.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {preparation.businesses.length ? (
              preparation.businesses.map((business) => {
                const selected = business.id === effectiveBusinessId;
                return (
                  <button
                    key={business.id}
                    type="button"
                    onClick={() => setSelectedBusinessId(business.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selected
                        ? "border-orange-400 bg-orange-50 ring-2 ring-orange-100"
                        : "border-stone-200 bg-white hover:border-orange-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-stone-950">{business.name}</p>
                        <p className="mt-1 text-xs text-stone-600">
                          {business.isFoodTruck ? "Food truck" : business.businessType || "Food business"}
                        </p>
                      </div>
                      {selected ? (
                        <CheckCircle2 className="h-5 w-5 text-orange-600" />
                      ) : null}
                    </div>
                  </button>
                );
              })
            ) : (
              <Alert>
                <AlertTitle>No owner business is attached</AlertTitle>
                <AlertDescription>
                  Finish or claim your business in MealScout before connecting an AI.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {selectedBusiness ? (
          <Card data-testid="owner-ai-oauth-social-readiness">
            <CardHeader>
              <CardTitle>Connect at least one social account</CardTitle>
              <CardDescription>
                This completes the working chain: your AI signs into MealScout,
                then MealScout publishes only to accounts you connected and only
                after your approval.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {selectedBusiness.socialConnections.map((connection) => {
                const provider = connection.platform === "x" ? "x" : "meta";
                const connectHref =
                  `/api/restaurants/${encodeURIComponent(selectedBusiness.id)}` +
                  `/social-connections/${provider}/start?platform=${encodeURIComponent(connection.platform)}` +
                  `&redirect=${encodeURIComponent(returnPath)}`;
                return (
                  <div
                    key={connection.platform}
                    className="rounded-xl border border-stone-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-black text-stone-900">
                        {platformLabel(connection.platform)}
                      </p>
                      <Badge variant={connection.connected ? "default" : "outline"}>
                        {connection.connected
                          ? "Connected"
                          : connectedSocials.length
                            ? "Optional"
                            : "Choose one"}
                      </Badge>
                    </div>
                    <p className="mt-2 truncate text-xs text-stone-600">
                      {connection.connected
                        ? connection.displayName || "Ready to publish"
                        : "Not linked to MealScout"}
                    </p>
                    <Button asChild size="sm" variant="outline" className="mt-3 w-full">
                      <a href={connectHref}>
                        {connection.connected ? "Reconnect" : "Connect"}
                        <ExternalLink className="ml-2 h-3 w-3" />
                      </a>
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        {authorizeMutation.error ? (
          <Alert variant="destructive">
            <AlertTitle>Connection not completed</AlertTitle>
            <AlertDescription>
              {authorizeMutation.error instanceof Error
                ? authorizeMutation.error.message
                : "Try the MealScout sign-in again."}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={denyMutation.isPending || authorizeMutation.isPending}
            onClick={() => denyMutation.mutate()}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              !effectiveBusinessId ||
              connectedSocials.length === 0 ||
              authorizeMutation.isPending ||
              denyMutation.isPending
            }
            onClick={() => authorizeMutation.mutate()}
          >
            {authorizeMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" />
            )}
            Connect {preparation.client.clientName}
          </Button>
        </div>
        {selectedBusiness && connectedSocials.length === 0 ? (
          <p className="text-center text-xs font-semibold text-amber-800">
            Connect Facebook, Instagram, or X above to enable the AI sign-in.
          </p>
        ) : null}
      </div>
    </main>
  );
}
