import { GOOGLE_MAPS_WEB_API_KEY } from "@/lib/mapProvider";

const parseJsonArray = (value: unknown): any[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const toExternalImageUrl = (value: unknown): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:|\/)/i.test(raw)) return raw;
  return `https://${raw}`;
};

export const buildGooglePlacesPhotoUrl = (
  photoName: string,
  apiKey = GOOGLE_MAPS_WEB_API_KEY,
  maxWidth = 960,
) => {
  const name = String(photoName || "").trim();
  if (!name) return "";
  const key = String(apiKey || "").trim();
  if (!key) {
    return `/api/google/photo?name=${encodeURIComponent(name)}&maxWidth=${maxWidth}`;
  }
  return `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxWidth}&key=${encodeURIComponent(key)}`;
};

export const getGooglePhotoSrc = (
  photos: unknown,
  apiKey = GOOGLE_MAPS_WEB_API_KEY,
) => {
  const firstPhoto = parseJsonArray(photos)[0] as any;
  const directUrl = toExternalImageUrl(
    firstPhoto?.url || firstPhoto?.photoUrl || firstPhoto?.src,
  );
  if (directUrl) return directUrl;

  const photoName = String(
    firstPhoto?.name ||
      firstPhoto?.photoName ||
      firstPhoto?.photoReference ||
      "",
  ).trim();
  return photoName ? buildGooglePlacesPhotoUrl(photoName, apiKey) : "";
};

export const buildGoogleStreetViewImageUrl = (
  locationQuery: string | null | undefined,
  apiKey = GOOGLE_MAPS_WEB_API_KEY,
) => {
  const query = String(locationQuery || "").trim();
  const key = String(apiKey || "").trim();
  if (!query || !key) return "";
  return `https://maps.googleapis.com/maps/api/streetview?size=960x540&location=${encodeURIComponent(query)}&fov=90&pitch=5&source=outdoor&key=${encodeURIComponent(key)}`;
};

export const buildGoogleStaticMapImageUrl = (
  locationQuery: string | null | undefined,
  apiKey = GOOGLE_MAPS_WEB_API_KEY,
) => {
  const query = String(locationQuery || "").trim();
  const key = String(apiKey || "").trim();
  if (!query || !key) return "";
  const encoded = encodeURIComponent(query);
  return `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=16&size=640x360&scale=1&maptype=roadmap&markers=color:0xF97316%7C${encoded}&key=${encodeURIComponent(key)}`;
};

export function resolveBusinessImageUrl(options: {
  uploaded?: unknown[];
  googlePhotos?: unknown;
  locationQuery?: string | null;
  apiKey?: string | null;
}) {
  const uploaded = options.uploaded || [];
  for (const candidate of uploaded) {
    const url = toExternalImageUrl(candidate);
    if (url) return url;
  }

  const googlePhoto = getGooglePhotoSrc(
    options.googlePhotos,
    options.apiKey || GOOGLE_MAPS_WEB_API_KEY,
  );
  if (googlePhoto) return googlePhoto;

  return (
    buildGoogleStreetViewImageUrl(
      options.locationQuery,
      options.apiKey || "",
    ) ||
    buildGoogleStaticMapImageUrl(options.locationQuery, options.apiKey || "")
  );
}
