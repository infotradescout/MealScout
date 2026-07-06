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

  const handleRecommend = useCallback(async () => {
    if (!isAuthenticated) {
      const continuationPath = profilePath || window.location.pathname;
      window.location.href = `/login?continuation=${encodeURIComponent(continuationPath)}`;
      return;
    }
    if (isRecommended || isPending) return;

    setIsPending(true);
    setIsRecommended(true); // optimistic

    try {
      const res = await fetch(
        apiUrl(`/api/restaurants/${encodeURIComponent(restaurantId)}/recommend`),
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to recommend");
    } catch {
      setIsRecommended(false); // revert on failure
    } finally {
      setIsPending(false);
    }
  }, [isAuthenticated, isRecommended, isPending, restaurantId, profilePath]);

  return (
    <button
      type="button"
      aria-label={isRecommended ? "Recommended" : "Recommend this place"}
      aria-pressed={isRecommended}
      disabled={isPending || isRecommended}
      onClick={handleRecommend}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-bold transition-colors ${
        isRecommended
          ? "border-orange-400/50 bg-orange-500/15 text-orange-300"
          : "border-white/15 bg-black/20 text-white/70 hover:border-white/25 hover:text-white"
      } ${isPending ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <ThumbsUp
        className={`h-4 w-4 transition-transform ${isRecommended ? "fill-current scale-110" : ""}`}
      />
      {isRecommended ? "Recommended" : "Recommend"}
    </button>
  );
}
