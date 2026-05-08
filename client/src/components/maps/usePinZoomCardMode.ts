import { useCallback, useEffect, useMemo, useState } from "react";

type UsePinZoomCardModeOptions<T> = {
  enabled: boolean;
  zoom: number;
  cardsAtOrAboveZoom: number;
  markers: T[];
  markerId: (marker: T) => string;
  includeMarker?: (marker: T) => boolean;
  dedupeKey?: (marker: T) => string;
  maxCards?: number;
  hasBlockingSelection?: boolean;
};

type UsePinZoomCardModeResult<T> = {
  cards: T[];
  showCards: boolean;
  activeCardId: string | null;
  setActiveCardId: (id: string | null) => void;
  clearActiveCard: () => void;
};

export function usePinZoomCardMode<T>({
  enabled,
  zoom,
  cardsAtOrAboveZoom,
  markers,
  markerId,
  includeMarker,
  dedupeKey,
  maxCards = 8,
  hasBlockingSelection = false,
}: UsePinZoomCardModeOptions<T>): UsePinZoomCardModeResult<T> {
  const cards = useMemo(() => {
    const filtered = includeMarker ? markers.filter(includeMarker) : markers;
    const seen = new Set<string>();
    const deduped: T[] = [];

    for (const marker of filtered) {
      const key = String(
        (dedupeKey ? dedupeKey(marker) : markerId(marker)) || "",
      );
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(marker);
      if (deduped.length >= maxCards) break;
    }

    return deduped;
  }, [markers, includeMarker, dedupeKey, markerId, maxCards]);

  const showCards =
    enabled &&
    Number.isFinite(zoom) &&
    zoom >= cardsAtOrAboveZoom &&
    !hasBlockingSelection &&
    cards.length > 0;

  const [activeCardId, setActiveCardIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCardId) return;
    const stillExists = cards.some((card) => markerId(card) === activeCardId);
    if (!stillExists) {
      setActiveCardIdState(null);
    }
  }, [cards, activeCardId, markerId]);

  useEffect(() => {
    if (!showCards && activeCardId !== null) {
      setActiveCardIdState(null);
    }
  }, [showCards, activeCardId]);

  const setActiveCardId = useCallback((id: string | null) => {
    setActiveCardIdState(id ? String(id) : null);
  }, []);

  const clearActiveCard = useCallback(() => {
    setActiveCardIdState(null);
  }, []);

  return {
    cards,
    showCards,
    activeCardId,
    setActiveCardId,
    clearActiveCard,
  };
}

