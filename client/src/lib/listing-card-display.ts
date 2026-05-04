import {
  getGooglePhotoSrc,
  toExternalImageUrl,
} from "@/lib/business-images";
import type { SyntheticEvent } from "react";

type ListingImageInput = {
  name?: unknown;
  restaurantName?: unknown;
  hostBusinessName?: unknown;
  title?: unknown;
  cuisineType?: unknown;
  businessType?: unknown;
  description?: unknown;
  imageUrl?: unknown;
  mediaUrl?: unknown;
  thumbnailUrl?: unknown;
  spotImageUrl?: unknown;
  hostSpotImageUrl?: unknown;
  logoUrl?: unknown;
  coverImageUrl?: unknown;
  facebookCoverUrl?: unknown;
  facebookPhotos?: unknown;
  googlePhotos?: unknown;
  restaurant?: ListingImageInput | null;
};

type LocationInput = {
  address?: unknown;
  city?: unknown;
  state?: unknown;
};

const CATEGORY_IMAGE_URLS: Record<string, string> = {
  asian:
    "https://images.unsplash.com/photo-1563379091339-03246963d51a?w=960&h=640&fit=crop&auto=format",
  bakery:
    "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=960&h=640&fit=crop&auto=format",
  bbq:
    "https://images.unsplash.com/photo-1544025162-d76694265947?w=960&h=640&fit=crop&auto=format",
  breakfast:
    "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=960&h=640&fit=crop&auto=format",
  burger:
    "https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=960&h=640&fit=crop&auto=format",
  cafe:
    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=960&h=640&fit=crop&auto=format",
  dessert:
    "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=960&h=640&fit=crop&auto=format",
  event:
    "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=960&h=640&fit=crop&auto=format",
  healthy:
    "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=960&h=640&fit=crop&auto=format",
  mexican:
    "https://images.unsplash.com/photo-1565299507177-b0ac66763828?w=960&h=640&fit=crop&auto=format",
  parking:
    "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=960&h=640&fit=crop&auto=format",
  pizza:
    "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=960&h=640&fit=crop&auto=format",
  seafood:
    "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=960&h=640&fit=crop&auto=format",
  sushi:
    "https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=960&h=640&fit=crop&auto=format",
  truck:
    "https://images.unsplash.com/photo-1565123409695-7b5ef63a2efb?w=960&h=640&fit=crop&auto=format",
  default:
    "https://images.unsplash.com/photo-1493770348161-369560ae357d?w=960&h=640&fit=crop&auto=format",
};

const clean = (value: unknown) => String(value || "").trim();
const lower = (value: unknown) => clean(value).toLowerCase();

const firstJsonPhotoUrl = (value: unknown) => {
  const photos = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  for (const photo of photos) {
    const url = toExternalImageUrl(
      photo?.url || photo?.imageUrl || photo?.photoUrl || photo?.src,
    );
    if (url) return url;
  }

  return "";
};

export const getCategoryFallbackImageUrl = (input?: ListingImageInput | null) => {
  const haystack = [
    input?.name,
    input?.restaurantName,
    input?.hostBusinessName,
    input?.title,
    input?.cuisineType,
    input?.businessType,
    input?.description,
    input?.restaurant?.name,
    input?.restaurant?.cuisineType,
    input?.restaurant?.businessType,
  ]
    .map(lower)
    .join(" ");

  if (haystack.includes("pizza")) return CATEGORY_IMAGE_URLS.pizza;
  if (haystack.includes("burger") || haystack.includes("sandwich")) {
    return CATEGORY_IMAGE_URLS.burger;
  }
  if (
    haystack.includes("seafood") ||
    haystack.includes("shrimp") ||
    haystack.includes("fish") ||
    haystack.includes("lobster") ||
    haystack.includes("crab") ||
    haystack.includes("chowder")
  ) {
    return CATEGORY_IMAGE_URLS.seafood;
  }
  if (haystack.includes("sushi")) return CATEGORY_IMAGE_URLS.sushi;
  if (haystack.includes("mexican") || haystack.includes("taco")) {
    return CATEGORY_IMAGE_URLS.mexican;
  }
  if (
    haystack.includes("asian") ||
    haystack.includes("thai") ||
    haystack.includes("chinese") ||
    haystack.includes("korean") ||
    haystack.includes("japanese")
  ) {
    return CATEGORY_IMAGE_URLS.asian;
  }
  if (haystack.includes("bbq") || haystack.includes("barbecue")) {
    return CATEGORY_IMAGE_URLS.bbq;
  }
  if (
    haystack.includes("breakfast") ||
    haystack.includes("brunch") ||
    haystack.includes("coffee")
  ) {
    return haystack.includes("coffee")
      ? CATEGORY_IMAGE_URLS.cafe
      : CATEGORY_IMAGE_URLS.breakfast;
  }
  if (
    haystack.includes("dessert") ||
    haystack.includes("cake") ||
    haystack.includes("bakery")
  ) {
    return haystack.includes("bakery")
      ? CATEGORY_IMAGE_URLS.bakery
      : CATEGORY_IMAGE_URLS.dessert;
  }
  if (
    haystack.includes("healthy") ||
    haystack.includes("salad") ||
    haystack.includes("vegan")
  ) {
    return CATEGORY_IMAGE_URLS.healthy;
  }
  if (haystack.includes("parking")) return CATEGORY_IMAGE_URLS.parking;
  if (haystack.includes("event")) return CATEGORY_IMAGE_URLS.event;
  if (haystack.includes("truck")) return CATEGORY_IMAGE_URLS.truck;

  return CATEGORY_IMAGE_URLS.default;
};

export const resolveListingImageUrl = (input?: ListingImageInput | null) => {
  const restaurant = input?.restaurant || null;
  const candidates = [
    input?.imageUrl,
    input?.mediaUrl,
    input?.thumbnailUrl,
    input?.spotImageUrl,
    input?.hostSpotImageUrl,
    input?.coverImageUrl,
    restaurant?.coverImageUrl,
    input?.facebookCoverUrl,
    restaurant?.facebookCoverUrl,
    input?.logoUrl,
    restaurant?.logoUrl,
  ];

  for (const candidate of candidates) {
    const url = toExternalImageUrl(candidate);
    if (url) return url;
  }

  const directPhoto =
    firstJsonPhotoUrl(input?.facebookPhotos) ||
    firstJsonPhotoUrl(restaurant?.facebookPhotos);
  if (directPhoto) return directPhoto;

  const googlePhoto =
    getGooglePhotoSrc(input?.googlePhotos) ||
    getGooglePhotoSrc(restaurant?.googlePhotos);
  if (googlePhoto) return googlePhoto;

  return getCategoryFallbackImageUrl(input);
};

export const resolveImageFallback = (
  event: SyntheticEvent<HTMLImageElement>,
  input?: ListingImageInput | null,
) => {
  const fallback = getCategoryFallbackImageUrl(input);
  const target = event.currentTarget;
  if (target.src !== fallback) {
    target.src = fallback;
  }
};

export const getLocationLine = (input?: LocationInput | null) => {
  const address = clean(input?.address);
  const cityState = [input?.city, input?.state].map(clean).filter(Boolean);

  if (address && cityState.length > 0) {
    return `${address} - ${cityState.join(", ")}`;
  }
  if (address) return address;
  if (cityState.length > 0) return cityState.join(", ");
  return "Location pending";
};

export const getCategoryLine = (input?: ListingImageInput | null) => {
  const category = clean(input?.cuisineType || input?.restaurant?.cuisineType);
  if (category) return category;
  if (input?.businessType === "parking") return "Parking Pass";
  if (input?.businessType === "event") return "Public Event";
  if (input?.restaurant?.businessType === "food_truck") return "Food Truck";
  if (input?.businessType === "food_truck") return "Food Truck";
  if (input?.restaurant?.businessType === "private_chef") return "Private Chef";
  if (input?.businessType === "private_chef") return "Private Chef";
  if (input?.restaurant?.businessType === "caterer") return "Caterer";
  if (input?.businessType === "caterer") return "Caterer";
  return "Local Food";
};
