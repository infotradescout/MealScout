import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Lightbulb,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";

import type {
  ProfileEvidenceOwnerProposalDto,
  ProfileEvidenceOwnerReviewDto,
} from "@shared/profileEvidenceReview";
import { apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type OwnerProfileEvidenceReviewProps = {
  restaurantId: string;
  review?: ProfileEvidenceOwnerReviewDto;
  isLoading: boolean;
  isRefreshing?: boolean;
  isError: boolean;
  errorMessage?: string;
  onRefresh: () => Promise<unknown>;
  onProfileRefresh: (
    field: ProfileEvidenceOwnerProposalDto["field"],
  ) => Promise<unknown>;
};

type DecisionAction = "confirm" | "correct" | "decline";

type DecisionVariables = {
  proposal: ProfileEvidenceOwnerProposalDto;
  action: DecisionAction;
  correctedValue?: string;
  clientRequestId: string;
};

type DecisionResponse = {
  ok?: boolean;
  action?: string;
  proposalId?: string;
};

type Feedback = {
  kind: "success" | "error" | "stale";
  message: string;
};

type ReviewableEvidenceSource = ProfileEvidenceOwnerProposalDto["source"] & {
  images?: Array<{ id: string; url: string }>;
  reviewable?: boolean;
  unavailableReason?: string | null;
};

class EvidenceDecisionError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "EvidenceDecisionError";
    this.status = status;
    this.code = code;
  }
}

let fallbackRequestSequence = 0;

const createClientRequestId = () => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `profile-review:${uuid}`;

  fallbackRequestSequence += 1;
  return [
    "profile-review",
    Date.now().toString(36),
    fallbackRequestSequence.toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join(":");
};

const boundedText = (value: string | null, limit: number) => {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

const displayValue = (value: string | null) => {
  const text = String(value || "").trim();
  return text || "Not currently set";
};

const safeSourceUrl = (value: string | null) => {
  const bounded = boundedText(value, 500);
  if (!bounded) return "";
  try {
    const parsed = new URL(bounded);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? bounded
      : "";
  } catch {
    return "";
  }
};

const reviewableSource = (proposal: ProfileEvidenceOwnerProposalDto) =>
  proposal.source as ReviewableEvidenceSource;

const isProposalReviewable = (proposal: ProfileEvidenceOwnerProposalDto) =>
  reviewableSource(proposal).reviewable !== false;

const safeEvidenceImages = (source: ReviewableEvidenceSource) =>
  (Array.isArray(source.images) ? source.images : [])
    .map((image) => ({
      id: boundedText(String(image?.id || ""), 160),
      url: safeSourceUrl(String(image?.url || "")),
    }))
    .filter((image) => Boolean(image.id && image.url));

const sourceKindLabel = (kind: ProfileEvidenceOwnerProposalDto["source"]["kind"]) =>
  ({
    screenshot: "Screenshot",
    website: "Website",
    social: "Social profile",
    menu: "Menu",
    operator: "Business information",
    other: "Reference",
  })[kind];

const correctionMaxLength = (
  proposal: ProfileEvidenceOwnerProposalDto,
) => {
  switch (proposal.valueKind) {
    case "multiline_text":
      return 4000;
    case "phone":
      return 40;
    case "url":
      return 500;
    default:
      return 160;
  }
};

const readResponseBody = async (response: Response) => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export default function OwnerProfileEvidenceReview({
  restaurantId,
  review,
  isLoading,
  isRefreshing = false,
  isError,
  errorMessage,
  onRefresh,
  onProfileRefresh,
}: OwnerProfileEvidenceReviewProps) {
  const [correctingProposalId, setCorrectingProposalId] = useState<
    string | null
  >(null);
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const decisionMutation = useMutation<
    DecisionResponse,
    EvidenceDecisionError,
    DecisionVariables
  >({
    mutationFn: async ({
      proposal,
      action,
      correctedValue,
      clientRequestId,
    }) => {
      const response = await fetch(
        apiUrl(
          `/api/restaurants/${encodeURIComponent(restaurantId)}/profile-evidence-review/${encodeURIComponent(proposal.id)}`,
        ),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ...(action === "correct" ? { correctedValue } : {}),
            expectedCurrentValueFingerprint:
              proposal.currentValueFingerprint,
            clientRequestId,
          }),
        },
      );
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new EvidenceDecisionError(
          response.status,
          typeof body.code === "string" ? body.code : null,
          typeof body.message === "string"
            ? body.message
            : "MealScout could not save this review.",
        );
      }
      return body as DecisionResponse;
    },
    onSuccess: async (_result, variables) => {
      const { proposal, action } = variables;
      setCorrectingProposalId(null);
      setCorrectionValue("");
      setCorrectionError(null);
      setFeedback({
        kind: "success",
        message:
          action === "decline"
            ? `${proposal.label} suggestion declined.`
            : `${proposal.label} updated.`,
      });
      try {
        await Promise.all([
          onRefresh(),
          ...(action === "decline"
            ? []
            : [onProfileRefresh(proposal.field)]),
        ]);
      } catch {
        setFeedback({
          kind: "error",
          message:
            action === "decline"
              ? "Your decision was saved, but the suggestion list could not refresh. Reload this page before continuing."
              : `${proposal.label} was updated, but the editable profile could not refresh. Reload this page before saving the profile form.`,
        });
      }
    },
    onError: async (error) => {
      if (error.status === 409) {
        await onRefresh();
        setCorrectingProposalId(null);
        setCorrectionValue("");
        setCorrectionError(null);
        setFeedback({
          kind: "stale",
          message:
            error.code === "decision_conflict"
              ? "This suggestion was already reviewed elsewhere. We refreshed the list."
              : "This profile field changed while you were reviewing it. We refreshed the current value—please review it again.",
        });
        return;
      }
      setFeedback({
        kind: "error",
        message: error.message || "MealScout could not save this review.",
      });
    },
  });

  const startCorrection = (proposal: ProfileEvidenceOwnerProposalDto) => {
    if (!isProposalReviewable(proposal)) return;
    setFeedback(null);
    setCorrectionError(null);
    setCorrectingProposalId(proposal.id);
    setCorrectionValue(proposal.proposedValue);
  };

  const submitDecision = (
    proposal: ProfileEvidenceOwnerProposalDto,
    action: DecisionAction,
  ) => {
    if (decisionMutation.isPending) return;
    setFeedback(null);

    if (action !== "decline" && !isProposalReviewable(proposal)) {
      setFeedback({
        kind: "error",
        message:
          "This evidence is not visible enough to confirm or correct. You can decline the suggestion instead.",
      });
      return;
    }

    if (action === "correct") {
      const value = correctionValue.trim();
      if (!value) {
        setCorrectionError("Enter the value that should appear on your profile.");
        return;
      }
      setCorrectionError(null);
      decisionMutation.mutate({
        proposal,
        action,
        correctedValue: value,
        clientRequestId: createClientRequestId(),
      });
      return;
    }

    decisionMutation.mutate({
      proposal,
      action,
      clientRequestId: createClientRequestId(),
    });
  };

  if (isLoading) {
    return (
      <section
        id="owner-profile-evidence-review"
        className="mb-6 rounded-2xl border border-orange-200 bg-orange-50/70 p-4 sm:p-5"
        aria-busy="true"
        aria-labelledby="profile-evidence-review-loading-title"
        data-testid="owner-profile-evidence-review-loading"
      >
        <div className="flex items-center gap-3">
          <Loader2
            className="h-5 w-5 animate-spin text-orange-700"
            aria-hidden="true"
          />
          <div>
            <h2
              id="profile-evidence-review-loading-title"
              className="font-black text-orange-950"
            >
              Checking for profile suggestions
            </h2>
            <p className="mt-1 text-sm text-orange-900/75">
              Loading suggestions for this business only.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section
        id="owner-profile-evidence-review"
        className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 sm:p-5"
        aria-labelledby="profile-evidence-review-error-title"
        data-testid="owner-profile-evidence-review-error"
      >
        <div className="flex items-start gap-3">
          <AlertCircle
            className="mt-0.5 h-5 w-5 shrink-0 text-red-700"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h2
              id="profile-evidence-review-error-title"
              className="font-black text-red-950"
            >
              Profile suggestions could not be loaded
            </h2>
            <p className="mt-1 text-sm text-red-900/80">
              {errorMessage || "Try again before reviewing profile changes."}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 min-h-10 border-red-300 bg-white text-red-900 hover:bg-red-100"
              onClick={() => void onRefresh()}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Try again
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const selectedReview =
    review?.restaurantId === restaurantId ? review : undefined;
  const proposals = selectedReview?.proposals || [];
  const pendingCount = selectedReview?.pendingCount || proposals.length;

  if (pendingCount === 0 || proposals.length === 0) {
    return (
      <section
        id="owner-profile-evidence-review"
        className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 sm:p-5"
        aria-labelledby="profile-evidence-review-empty-title"
        data-testid="owner-profile-evidence-review-empty"
      >
        <div className="flex items-start gap-3">
          <Check
            className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700"
            aria-hidden="true"
          />
          <div>
            <h2
              id="profile-evidence-review-empty-title"
              className="font-black text-emerald-950"
            >
              No profile suggestions waiting
            </h2>
            <p className="mt-1 text-sm text-emerald-900/75">
              Your editable profile fields are below.
            </p>
          </div>
        </div>
        {feedback ? (
          <p
            className={`mt-3 rounded-xl border px-3 py-2 text-sm font-medium ${
              feedback.kind === "success"
                ? "border-emerald-200 bg-white text-emerald-950"
                : feedback.kind === "stale"
                  ? "border-amber-300 bg-amber-50 text-amber-950"
                  : "border-red-200 bg-red-50 text-red-950"
            }`}
            role={feedback.kind === "error" ? "alert" : "status"}
            aria-live={feedback.kind === "error" ? "assertive" : "polite"}
          >
            {feedback.message}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      id="owner-profile-evidence-review"
      className="mb-6 scroll-mt-24 rounded-2xl border border-orange-200 bg-orange-50/60 p-4 shadow-sm sm:p-5"
      aria-labelledby="profile-evidence-review-title"
      data-testid="owner-profile-evidence-review"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-800">
            <Lightbulb className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.15em] text-orange-700">
              Needs your review
            </p>
            <h2
              id="profile-evidence-review-title"
              className="mt-1 text-xl font-black tracking-tight text-orange-950"
            >
              {pendingCount} profile {pendingCount === 1 ? "suggestion" : "suggestions"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-orange-900/75">
              MealScout found public information that may improve this profile.
              Nothing changes until you confirm or correct it.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-10 w-full border-orange-300 bg-white text-orange-950 hover:bg-orange-100 sm:w-auto"
          onClick={() => void onRefresh()}
          disabled={isRefreshing || decisionMutation.isPending}
          aria-label="Refresh profile suggestions"
        >
          {isRefreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>

      {feedback ? (
        <div
          className={`mt-4 rounded-xl border px-3 py-2 text-sm font-medium ${
            feedback.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : feedback.kind === "stale"
                ? "border-amber-300 bg-amber-50 text-amber-950"
                : "border-red-200 bg-red-50 text-red-950"
          }`}
          role={feedback.kind === "error" ? "alert" : "status"}
          aria-live={feedback.kind === "error" ? "assertive" : "polite"}
          data-testid="profile-evidence-review-feedback"
        >
          {feedback.message}
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {proposals.map((proposal) => {
          const source = reviewableSource(proposal);
          const isCorrecting = correctingProposalId === proposal.id;
          const isSubmittingThis =
            decisionMutation.isPending &&
            decisionMutation.variables?.proposal.id === proposal.id;
          const sourceLabel = boundedText(proposal.source.label, 160);
          const sourceUrl = safeSourceUrl(proposal.source.url);
          const sourceUrlLabel = boundedText(proposal.source.url, 180);
          const sourceExcerpt = boundedText(proposal.source.excerpt, 360);
          const sourceImages = safeEvidenceImages(source);
          const evidenceReviewable = source.reviewable !== false;
          const unavailableReason = boundedText(
            source.unavailableReason || null,
            360,
          );
          const correctionId = `profile-evidence-correction-${proposal.id}`;
          const correctionErrorId = `${correctionId}-error`;

          return (
            <article
              key={proposal.id}
              className="min-w-0 rounded-2xl border border-orange-200 bg-white p-4 sm:p-5"
              aria-busy={isSubmittingThis}
              data-testid={`profile-evidence-proposal-${proposal.field}`}
            >
              <h3 className="text-base font-black text-[color:var(--text-primary)]">
                {proposal.label}
              </h3>

              <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="min-w-0 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-layered)] p-3">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                    Current
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[color:var(--text-secondary)]">
                    {displayValue(proposal.currentValue)}
                  </p>
                </div>
                <div className="min-w-0 rounded-xl border border-orange-300 bg-orange-50 p-3">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-orange-800">
                    Suggested
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold leading-6 text-orange-950">
                    {proposal.proposedValue}
                  </p>
                </div>
              </div>

              {(sourceLabel || sourceUrl || sourceExcerpt || sourceImages.length > 0) && (
                <div className="mt-3 min-w-0 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-layered)] p-3">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                    Source
                  </p>
                  <p className="mt-1 break-words text-sm font-semibold text-[color:var(--text-primary)]">
                    {sourceLabel || sourceKindLabel(proposal.source.kind)}
                  </p>
                  {sourceExcerpt ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-[color:var(--text-secondary)]">
                      {sourceExcerpt}
                    </p>
                  ) : null}
                  {sourceUrl ? (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex max-w-full items-center gap-1 text-sm font-semibold text-orange-800 underline decoration-orange-300 underline-offset-4 hover:text-orange-950"
                    >
                      <span className="min-w-0 break-all">{sourceUrlLabel}</span>
                      <ExternalLink
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : null}
                  {sourceImages.length > 0 ? (
                    <div
                      className="mt-3"
                      data-testid={`profile-evidence-images-${proposal.field}`}
                    >
                      <p className="text-xs font-black uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                        Evidence images
                      </p>
                      <div className="mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {sourceImages.map((image, index) => (
                          <a
                            key={`${image.id}:${image.url}`}
                            href={image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="group min-w-0 overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                            aria-label={`Open evidence image ${index + 1} for ${proposal.label} in a new tab`}
                          >
                            <img
                              src={image.url}
                              alt={`Evidence image ${index + 1} for ${proposal.label}`}
                              className="aspect-[4/3] h-auto w-full object-cover transition-transform group-hover:scale-[1.02]"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {!evidenceReviewable ? (
                <div
                  className="mt-3 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950"
                  role="alert"
                  data-testid={`profile-evidence-unavailable-${proposal.field}`}
                >
                  <AlertCircle
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-black">Evidence is not available to inspect</p>
                    <p className="mt-1 break-words text-sm leading-5 text-amber-900">
                      {unavailableReason ||
                        "The referenced evidence cannot be shown here. Confirm and Correct stay unavailable, but you can decline this suggestion."}
                    </p>
                  </div>
                </div>
              ) : null}

              {isCorrecting ? (
                <div className="mt-4 rounded-xl border border-orange-300 bg-orange-50 p-3 sm:p-4">
                  <label
                    htmlFor={correctionId}
                    className="text-sm font-black text-orange-950"
                  >
                    Correct value for {proposal.label}
                  </label>
                  {proposal.valueKind === "multiline_text" ? (
                    <Textarea
                      id={correctionId}
                      className="mt-2 min-h-28 bg-white"
                      value={correctionValue}
                      maxLength={correctionMaxLength(proposal)}
                      onChange={(event) => {
                        setCorrectionValue(event.target.value);
                        setCorrectionError(null);
                      }}
                      aria-invalid={Boolean(correctionError)}
                      aria-describedby={correctionError ? correctionErrorId : undefined}
                      autoFocus
                    />
                  ) : (
                    <Input
                      id={correctionId}
                      className="mt-2 min-h-11 bg-white"
                      type={
                        proposal.valueKind === "url"
                          ? "url"
                          : proposal.valueKind === "phone"
                            ? "tel"
                            : "text"
                      }
                      value={correctionValue}
                      maxLength={correctionMaxLength(proposal)}
                      onChange={(event) => {
                        setCorrectionValue(event.target.value);
                        setCorrectionError(null);
                      }}
                      aria-invalid={Boolean(correctionError)}
                      aria-describedby={correctionError ? correctionErrorId : undefined}
                      autoFocus
                    />
                  )}
                  {correctionError ? (
                    <p
                      id={correctionErrorId}
                      className="mt-2 text-sm font-medium text-red-700"
                      role="alert"
                    >
                      {correctionError}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button
                      type="button"
                      className="min-h-11 w-full sm:w-auto"
                      onClick={() => submitDecision(proposal, "correct")}
                      disabled={decisionMutation.isPending || !evidenceReviewable}
                      data-testid={`button-save-evidence-correction-${proposal.field}`}
                    >
                      {isSubmittingThis ? (
                        <Loader2
                          className="mr-2 h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                      )}
                      Save correction
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full bg-white sm:w-auto"
                      onClick={() => {
                        setCorrectingProposalId(null);
                        setCorrectionValue("");
                        setCorrectionError(null);
                      }}
                      disabled={decisionMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    type="button"
                    className="min-h-11 w-full sm:w-auto"
                    onClick={() => submitDecision(proposal, "confirm")}
                    disabled={decisionMutation.isPending || !evidenceReviewable}
                    data-testid={`button-confirm-evidence-${proposal.field}`}
                  >
                    {isSubmittingThis &&
                    decisionMutation.variables?.action === "confirm" ? (
                      <Loader2
                        className="mr-2 h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full bg-white sm:w-auto"
                    onClick={() => startCorrection(proposal)}
                    disabled={decisionMutation.isPending || !evidenceReviewable}
                    data-testid={`button-correct-evidence-${proposal.field}`}
                  >
                    <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                    Correct
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 w-full text-[color:var(--text-secondary)] sm:w-auto"
                    onClick={() => submitDecision(proposal, "decline")}
                    disabled={decisionMutation.isPending}
                    data-testid={`button-decline-evidence-${proposal.field}`}
                  >
                    {isSubmittingThis &&
                    decisionMutation.variables?.action === "decline" ? (
                      <Loader2
                        className="mr-2 h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <X className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Decline
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
