/**
 * ProfileRecommendButton
 *
 * Lets authenticated users recommend a business directly from the public
 * profile, independent of any specific menu item. This matters most for thin
 * (mostly unclaimed) profiles, which have no menu items to hang a per-dish
 * recommend on but should still be recommendable.
 *
 * One-way action (no un-recommend) - the API already treats a duplicate
 * recommend as a graceful no-op, so this just optimistically flips to a
 * "Recommended" state on click.
 *
 * For guests, tapping the button routes to /login with a continuation path.
 */
import { useState, useCallback, useEffect } from "react";
import { ThumbsUp } from "lucide-react";
import { apiUrl } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type ProfileRecommendButtonProps = {
  restaurantId: string;
  isAuthenticated: boolean;
  profilePath?: string;
};

const QUICK_REVIEW_SCORE_KEYS = ["food", "value", "speed", "vibe"] as const;
type QuickReviewScoreKey = (typeof QUICK_REVIEW_SCORE_KEYS)[number];

export function ProfileRecommendButton({
  restaurantId,
  isAuthenticated,
  profilePath,
}: ProfileRecommendButtonProps) {
  const [isRecommended, setIsRecommended] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmittingContext, setIsSubmittingContext] = useState(false);
  const [contextSaved, setContextSaved] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [recommendationText, setRecommendationText] = useState("");
  const [proofImage, setProofImage] = useState<File | null>(null);
  const [scores, setScores] = useState({
    food: 50,
    value: 50,
    speed: 50,
    vibe: 50,
  });
  const [touchedScores, setTouchedScores] = useState<
    Partial<Record<QuickReviewScoreKey, true>>
  >({});

  const hasDraftContext = Boolean(
    recommendationText.trim() ||
      proofImage ||
      QUICK_REVIEW_SCORE_KEYS.some((key) => touchedScores[key]),
  );

  useEffect(() => {
    setIsRecommended(false);
    setIsPending(false);
    setIsDialogOpen(false);
    setIsSubmittingContext(false);
    setContextSaved(false);
    setContextError(null);
    setRecommendationText("");
    setProofImage(null);
    setScores({ food: 50, value: 50, speed: 50, vibe: 50 });
    setTouchedScores({});
  }, [restaurantId]);

  const submitShallowRecommend = useCallback(async () => {
    if (isRecommended) {
      return { ok: true, contextAlreadySaved: contextSaved };
    }
    setIsPending(true);
    setIsRecommended(true);
    try {
      const res = await fetch(
        apiUrl(
          `/api/restaurants/${encodeURIComponent(restaurantId)}/recommend`,
        ),
        { method: "POST", credentials: "include" },
      );
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("Failed to recommend");
      const contextAlreadySaved =
        responseBody?.contextAlreadySaved === true ||
        Boolean(responseBody?.contextSubmittedAt);
      if (contextAlreadySaved) setContextSaved(true);
      return { ok: true, contextAlreadySaved };
    } catch {
      setIsRecommended(false);
      return { ok: false, contextAlreadySaved: false };
    } finally {
      setIsPending(false);
    }
  }, [contextSaved, isRecommended, restaurantId]);

  const handleRecommend = useCallback(async () => {
    if (!isAuthenticated) {
      const continuationPath = profilePath || window.location.pathname;
      window.location.href = `/login?continuation=${encodeURIComponent(continuationPath)}`;
      return;
    }
    if (isPending) return;
    const result = await submitShallowRecommend();
    if (result.ok && !result.contextAlreadySaved) setIsDialogOpen(true);
  }, [isAuthenticated, isPending, profilePath, submitShallowRecommend]);

  const handleSubmitContext = useCallback(async () => {
    const text = recommendationText.trim();
    const submittedScores = Object.fromEntries(
      QUICK_REVIEW_SCORE_KEYS.filter((key) => touchedScores[key]).map((key) => [
        key,
        scores[key],
      ]),
    );
    if (!text && !proofImage && Object.keys(submittedScores).length === 0) {
      return;
    }
    setIsSubmittingContext(true);
    setContextError(null);
    try {
      const formData = new FormData();
      if (text) formData.append("comment", text);
      if (Object.keys(submittedScores).length > 0) {
        formData.append("scores", JSON.stringify(submittedScores));
      }
      if (proofImage) formData.append("image", proofImage);
      const res = await fetch(
        apiUrl(
          `/api/restaurants/${encodeURIComponent(restaurantId)}/recommend`,
        ),
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          String(responseBody?.message || "").trim() ||
            "Failed to save quick review",
        );
      }
      if (responseBody?.contextSaved !== true) {
        throw new Error("Quick review was not saved. Please try again.");
      }
      setContextSaved(true);
      setIsDialogOpen(false);
    } catch (error) {
      setContextError(
        error instanceof Error
          ? error.message
          : "Failed to save quick review. Please try again.",
      );
    } finally {
      setIsSubmittingContext(false);
    }
  }, [proofImage, recommendationText, restaurantId, scores, touchedScores]);

  const updateScore = (key: QuickReviewScoreKey, value: number) => {
    setScores((current) => ({ ...current, [key]: value }));
    setTouchedScores((current) => ({ ...current, [key]: true }));
    setContextError(null);
  };

  return (
    <>
      <button
        type="button"
        aria-label={isRecommended ? "Recommended" : "Recommend this place"}
        aria-pressed={isRecommended}
        disabled={isPending}
        onClick={handleRecommend}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-bold transition-colors ${
          isRecommended
            ? "border-orange-400/50 bg-orange-500/15 text-orange-300"
            : "border-white/15 bg-black/20 text-white/70 hover:border-white/25 hover:text-white"
        } ${isPending ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <ThumbsUp
          className={`h-4 w-4 transition-transform ${isRecommended ? "scale-110 fill-current" : ""}`}
        />
        {isRecommended ? "Recommended" : "Recommend"}
      </button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[86vh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto border-white/10 bg-[#0f0d0b] text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Quick review</DialogTitle>
            <DialogDescription className="text-white/55">
              Add only the details you want to share. Untouched scores are not
              submitted, and closing this keeps your recommend either way.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Textarea
              value={recommendationText}
              onChange={(event) => {
                setRecommendationText(event.target.value);
                setContextError(null);
              }}
              placeholder="Optional: what should someone know before they go?"
              className="min-h-24 border-white/15 bg-black/25 text-white placeholder:text-white/35"
            />

            <label className="block rounded-xl border border-white/10 bg-black/20 p-3">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-white/45">
                Photo proof
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  setProofImage(event.target.files?.[0] || null);
                  setContextError(null);
                }}
                className="mt-2 block w-full text-xs text-white/65 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-white/15"
              />
              {proofImage ? (
                <span className="mt-2 block truncate text-xs text-orange-200">
                  {proofImage.name}
                </span>
              ) : null}
            </label>

            <div className="space-y-3">
              {(
                [
                  ["food", "Food"],
                  ["value", "Value"],
                  ["speed", "Speed"],
                  ["vibe", "Vibe"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <div className="mb-1 flex items-center justify-between text-xs font-semibold text-white/70">
                    <span>{label}</span>
                    <span>{touchedScores[key] ? scores[key] : "Not rated"}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={scores[key]}
                    onChange={(event) =>
                      updateScore(key, Number(event.target.value))
                    }
                    className="w-full accent-orange-500"
                  />
                </label>
              ))}
            </div>

            {contextError ? (
              <p className="text-sm font-semibold text-red-300" role="alert">
                {contextError}
              </p>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setIsDialogOpen(false)}
                className="min-h-10 rounded-xl border border-white/15 px-4 text-sm font-bold text-white/75 hover:bg-white/8"
              >
                Done
              </button>
              <button
                type="button"
                disabled={isSubmittingContext || !hasDraftContext || contextSaved}
                onClick={handleSubmitContext}
                className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-black hover:bg-orange-400 disabled:opacity-60"
              >
                {isSubmittingContext ? "Saving..." : "Share quick review"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
