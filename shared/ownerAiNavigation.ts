export type OwnerAiEntrySource =
  | "onboarding"
  | "settings"
  | "profile"
  | "profile-editor"
  | "completion";

export type OwnerAiFocus =
  | "all"
  | "profile"
  | "media"
  | "menu"
  | "schedule";

export type OwnerAiHrefOptions = {
  restaurantId?: string | null;
  source?: OwnerAiEntrySource | null;
  focus?: OwnerAiFocus | null;
  menuSource?: string | null;
  draftId?: string | null;
};

const appendIfPresent = (
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
) => {
  const normalized = String(value || "").trim();
  if (normalized) params.set(key, normalized);
};

export function buildOwnerAiHref({
  restaurantId,
  source,
  focus,
  menuSource,
  draftId,
}: OwnerAiHrefOptions = {}) {
  const params = new URLSearchParams();
  appendIfPresent(params, "restaurantId", restaurantId);
  appendIfPresent(params, "src", source);
  appendIfPresent(params, "focus", focus);
  appendIfPresent(params, "menuSource", menuSource);
  appendIfPresent(params, "ownerAiDraft", draftId);
  const query = params.toString();
  return `/owner-ai${query ? `?${query}` : ""}`;
}
