import { useEffect, useMemo, useState } from "react";

export type PinZoomCardMode = "pins" | "cards";

export interface UsePinZoomCardModeOptions<TMarker> {
  enabled: boolean;
  zoom: number;
  cardsAtOrAboveZoom: number;
  markers: TMarker[];
  markerId: (marker: TMarker) => string;
  includeMarker?: (marker: TMarker) => boolean;
  dedupeKey?: (marker: TMarker) => string;
  maxCards?: number;
  hasBlockingSelection?: boolean;
}

export interface PinZoomCardModeState<TMarker> {
  mode: PinZoomCardMode;
  showPins: boolean;
  showCards: boolean;
  cards: TMarker[];
  activeCardId: string | null;
  setActiveCardId: (id: string | null) => void;
  handlePinTap: (marker: TMarker) => void;
  clearActiveCard: () => void;
}

export function usePinZoomCardMode<TMarker>(
  options: UsePinZoomCardModeOptions<TMarker>,
): PinZoomCardModeState<TMarker> {
  const {
    enabled,
    zoom,
    cardsAtOrAboveZoom,
    markers,
    markerId,
    includeMarker,
    dedupeKey,
    maxCards = 8,
    hasBlockingSelection = false,
  } = options;

  const cards = useMemo(() => {
    const filtered = includeMarker ? markers.filter(includeMarker) : markers;
    const next = dedupeKey
      ? Array.from(
          new Map(filtered.map((marker) => [dedupeKey(marker), marker])).values(),
        )
      : filtered;
    return next.slice(0, Math.max(1, maxCards));
  }, [markers, includeMarker, dedupeKey, maxCards]);

  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const mode: PinZoomCardMode =
    enabled &&
    !hasBlockingSelection &&
    zoom >= cardsAtOrAboveZoom &&
    cards.length > 0
      ? "cards"
      : "pins";

  useEffect(() => {
    if (!activeCardId) return;
    const stillExists = cards.some((marker) => markerId(marker) === activeCardId);
    if (!stillExists) {
      setActiveCardId(null);
    }
  }, [cards, activeCardId, markerId]);

  useEffect(() => {
    if (mode !== "cards" && activeCardId) {
      setActiveCardId(null);
    }
  }, [mode, activeCardId]);

  return {
    mode,
    showPins: mode === "pins",
    showCards: mode === "cards",
    cards,
    activeCardId,
    setActiveCardId,
    handlePinTap: (marker: TMarker) => {
      if (mode === "cards") {
        setActiveCardId(markerId(marker));
      }
    },
    clearActiveCard: () => setActiveCardId(null),
  };
}
