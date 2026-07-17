/**
 * ProfileFavoriteButton
 *
 * Allows authenticated users to favorite or follow a business directly from
 * the public profile. Optimistic UI — state updates immediately, API call
 * fires in the background.
 *
 * For guests, tapping the button routes to /login with a continuation path.
 */
import { useState, useCallback } from "react";
import { Heart } from "lucide-react";
import { apiUrl } from "@/lib/api";

type ProfileFavoriteButtonProps = {
  restaurantId: string;
  isAuthenticated: boolean;
  initialIsFavorited?: boolean;
  onToggle?: (isFavorited: boolean) => void;
  profilePath?: string;
};

export function ProfileFavoriteButton({
  restaurantId,
  isAuthenticated,
  initialIsFavorited = false,
  onToggle,
  profilePath,
}: ProfileFavoriteButtonProps) {
  const [isFavorited, setIsFavorited] = useState(initialIsFavorited);
  const [isPending, setIsPending] = useState(false);

  const handleToggle = useCallback(async () => {
    if (!isAuthenticated) {
      const continuationPath = profilePath || window.location.pathname;
      window.location.href = `/login?continuation=${encodeURIComponent(continuationPath)}`;
      return;
    }

    const nextState = !isFavorited;
    setIsFavorited(nextState); // optimistic
    setIsPending(true);
    onToggle?.(nextState);

    try {
      await fetch(
        apiUrl(`/api/restaurants/${encodeURIComponent(restaurantId)}/favorite`),
        {
          method: nextState ? "POST" : "DELETE",
          credentials: "include",
        },
      );
    } catch {
      // Revert on failure
      setIsFavorited(!nextState);
      onToggle?.(!nextState);
    } finally {
      setIsPending(false);
    }
  }, [isAuthenticated, isFavorited, restaurantId, onToggle, profilePath]);

  return (
    <button
      type="button"
      aria-label={isFavorited ? "Remove from favorites" : "Save to favorites"}
      aria-pressed={isFavorited}
      disabled={isPending}
      onClick={handleToggle}
      className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
        isFavorited
          ? "border-rose-200 bg-rose-50 text-rose-600 shadow-sm"
          : "border-white/70 bg-white/90 text-[#6b4030] shadow-sm backdrop-blur hover:bg-white hover:text-[#d93f24]"
      } ${isPending ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <Heart
        className={`h-4 w-4 transition-transform ${isFavorited ? "fill-current scale-110" : ""}`}
      />
    </button>
  );
}
