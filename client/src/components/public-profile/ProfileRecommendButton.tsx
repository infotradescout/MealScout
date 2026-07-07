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
import { useState, useCallback } from "react";
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
  const [recommendationText, setRecommendationText] = useState("");
  const [scores, setScores] = useState({
    food: 80,
    value: 75,
    speed: 75,
    vibe: 75,
  });

  const submitShallowRecommend = useCallback(async () => {
    if (isRecommended) return true;
    setIsPending(true);
    setIsRecommended(true);
    try {
      const res = await fetch(
        apiUrl(`/api/restaurants/${encodeURIComponent(restaurantId)}/recommend`),
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to recommend");
      return true;
    } catch {
      setIsRecommended(false);
      return false;
    } finally {
      setIsPending(false);
    }
  }, [isRecommended, restaurantId]);

  const handleRecommend = useCallback(async () => {
    if (!isAuthenticated) {
      const continuationPath = profilePath || window.location.pathname;
      window.location.href = `/login?continuation=${encodeURIComponent(continuationPath)}`;
      return;
    }
    if (isPending) return;
    const ok = await submitShallowRecommend();
    if (ok) setIsDialogOpen(true);
  }, [isAuthenticated, isPending, profilePath, submitShallowRecommend]);

  const handleSubmitContext = useCallback(async () => {
    const text = recommendationText.trim();
    if (!text && contextSaved) return;
    setIsSubmittingContext(true);
    try {
      const averageScore =
        (scores.food + scores.value + scores.speed + scores.vibe) / 4;
      const rating = Math.max(1, Math.min(5, Math.round(averageScore / 20)));
      const scoreLines = [
        `Food: ${scores.food}/100`,
        `Value: ${scores.value}/100`,
        `Speed: ${scores.speed}/100`,
        `Vibe: ${scores.vibe}/100`,
      ].join("\n");
      const comment = [text, scoreLines].filter(Boolean).join("\n\n");
      const res = await fetch(apiUrl("/api/reviews"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId,
          rating,
          comment,
        }),
      });
      if (!res.ok) throw new Error("Failed to save context");
      setContextSaved(true);
      setIsDialogOpen(false);
    } finally {
      setIsSubmittingContext(false);
    }
  }, [contextSaved, recommendationText, restaurantId, scores]);

  const updateScore = (key: keyof typeof scores, value: number) => {
    setScores((current) => ({ ...current, [key]: value }));
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
            <DialogTitle className="text-white">Add context</DialogTitle>
            <DialogDescription className="text-white/55">
              Closing this keeps your lightweight recommend. Details add more
              local signal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Textarea
              value={recommendationText}
              onChange={(event) => setRecommendationText(event.target.value)}
              placeholder="What should someone know before they go?"
              className="min-h-24 border-white/15 bg-black/25 text-white placeholder:text-white/35"
            />

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
                    <span>{scores[key]}</span>
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
                disabled={isSubmittingContext}
                onClick={handleSubmitContext}
                className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-bold text-black hover:bg-orange-400 disabled:opacity-60"
              >
                {isSubmittingContext ? "Saving..." : "Add weight"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
