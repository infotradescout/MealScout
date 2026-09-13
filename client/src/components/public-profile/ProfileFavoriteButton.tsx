/**
 * ProfileFavoriteButton
 *
 * Allows authenticated users to favorite or follow a business directly from
 * the public profile. Optimistic UI — state updates immediately, API call
 * fires in the background.
 *
 * For guests, tapping the button routes to /login with a continuation path.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Heart } from "lucide-react";
import { apiUrl } from "@/lib/api";

type ProfileFavoriteButtonProps = {
  restaurantId: string;
  isAuthenticated: boolean;
  initialIsFavorited?: boolean;
  onToggle?: (isFavorited: boolean) => void;
  profilePath?: string;
};

export function ProfileFavoriteButton(props: ProfileFavoriteButtonProps) {
  return <FavoriteButton key={props.restaurantId} {...props} />;
}

function FavoriteButton({
  restaurantId,
  isAuthenticated,
  initialIsFavorited = false,
  onToggle,
  profilePath,
}: ProfileFavoriteButtonProps) {
  const [isFavorited, setIsFavorited] = useState(initialIsFavorited);
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!pendingRef.current) setIsFavorited(initialIsFavorited);
  }, [initialIsFavorited]);

  const handleToggle = useCallback(async () => {
    if (pendingRef.current) return;
    if (!isAuthenticated) {
      const continuationPath = profilePath || window.location.pathname;
      window.location.href = `/login?continuation=${encodeURIComponent(continuationPath)}`;
      return;
    }

    const nextState = !isFavorited;
    pendingRef.current = true;
    setIsFavorited(nextState); // optimistic
    setIsPending(true);
    onToggle?.(nextState);

    try {
      const response = await fetch(
        apiUrl(`/api/restaurants/${encodeURIComponent(restaurantId)}/favorite`),
        {
          method: nextState ? "POST" : "DELETE",
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error("Save failed");
      await queryClient.invalidateQueries({ queryKey: ["/api/favorites/restaurants"] });
    } catch {
      if (mountedRef.current) {
        setIsFavorited(!nextState);
        onToggle?.(!nextState);
        toast({ title: "Couldn't update your saved places", description: "Please try again.", variant: "destructive" });
      }
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setIsPending(false);
    }
  }, [isAuthenticated, isFavorited, restaurantId, onToggle, profilePath, queryClient, toast]);

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
