/**
 * ProfileFavoriteButton
 *
 * Allows authenticated users to favorite or follow a business directly from
 * the public profile. Saved state changes only after the server acknowledges it.
 *
 * For guests, tapping the button routes to /login with a continuation path.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { Heart } from "lucide-react";
import { apiUrl } from "@/lib/api";
import { publicProfileLoginHref } from "@/lib/public-profile-recovery";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setIsPending(false);
    setIsFavorited(initialIsFavorited);
    return () => { generation.current += 1; };
  }, [restaurantId, isAuthenticated]);
  useEffect(() => {
    if (!busy.current) setIsFavorited(initialIsFavorited);
  }, [initialIsFavorited]);

  const handleToggle = useCallback(async () => {
    if (!isAuthenticated) {
      window.location.href = publicProfileLoginHref(profilePath);
      return;
    }

    if (busy.current) return;
    busy.current = true;
    const requestGeneration = ++generation.current;
    const nextState = !isFavorited;
    setIsPending(true);

    try {
      const response = await fetch(
        apiUrl(`/api/restaurants/${encodeURIComponent(restaurantId)}/favorite`),
        {
          method: nextState ? "POST" : "DELETE",
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error("Save not confirmed");
      if (generation.current !== requestGeneration) return;
      setIsFavorited(nextState);
      onToggle?.(nextState);
      void queryClient.invalidateQueries({ queryKey: ["/api/favorites/restaurants"] });
    } catch {
      if (generation.current !== requestGeneration) return;
      toast({ title: "Save not confirmed", description: "Refresh the profile to check your saved places before trying again.", variant: "destructive" });
    } finally {
      if (generation.current === requestGeneration) { busy.current = false; setIsPending(false); }
    }
  }, [isAuthenticated, isFavorited, restaurantId, onToggle, profilePath, queryClient, toast]);

  return (
    <button
      type="button"
      aria-label={isFavorited ? "Remove from favorites" : "Save to favorites"}
      aria-pressed={isFavorited}
      disabled={isPending}
      onClick={handleToggle}
      aria-busy={isPending}
      className={`flex h-11 w-11 items-center justify-center rounded-full border transition-colors ${
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
