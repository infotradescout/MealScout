/**
 * Schema.org structured data helpers
 * Generates machine-readable markup for SEO and LLMO
 */

interface Restaurant {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  cuisineType?: string;
  imageUrl?: string;
  rating?: number;
  reviewCount?: number;
  priceRange?: number;
}

interface Deal {
  id: string;
  title: string;
  description: string;
  dealType: string;
  discountValue: string;
  startDate: string;
  endDate?: string;
  restaurantId: string;
  restaurantName?: string;
}

interface VideoRecommendation {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  uploadDate: string;
  duration?: number;
  transcript?: string;
  creatorName?: string;
}

interface PlaceEntity {
  id: string;
  name: string;
  url?: string;
  address?: string;
  city?: string;
  state?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

interface EventEntity {
  id: string;
  name: string;
  description?: string | null;
  startDate: string;
  endDate?: string | null;
  url?: string;
  location?: PlaceEntity;
}

/**
 * Generate FoodEstablishment schema for restaurant pages
 */
export function generateRestaurantSchema(restaurant: Restaurant) {
  const schema: any = {
    "@context": "https://schema.org",
    "@type": "FoodEstablishment",
    name: restaurant.name,
    identifier: restaurant.id,
  };

  if (restaurant.address || restaurant.city) {
    schema.address = {
      "@type": "PostalAddress",
      ...(restaurant.address && { streetAddress: restaurant.address }),
      ...(restaurant.city && { addressLocality: restaurant.city }),
      ...(restaurant.state && { addressRegion: restaurant.state }),
      ...(restaurant.zipCode && { postalCode: restaurant.zipCode }),
      addressCountry: "US",
    };
  }

  if (restaurant.phone) {
    schema.telephone = restaurant.phone;
  }

  if (restaurant.cuisineType) {
    schema.servesCuisine = restaurant.cuisineType;
  }

  if (restaurant.imageUrl) {
    schema.image = restaurant.imageUrl;
  }

  if (restaurant.priceRange) {
    schema.priceRange = "$".repeat(restaurant.priceRange);
  }

  return schema;
}

/**
 * Generate Offer schema for deal pages
 */
export function generateDealSchema(deal: Deal, restaurantName?: string) {
  const schema: any = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: deal.title,
    description: deal.description,
    identifier: deal.id,
    validFrom: deal.startDate,
  };

  if (deal.endDate) {
    schema.validThrough = deal.endDate;
  }

  if (deal.discountValue) {
    schema.priceSpecification = {
      "@type": "PriceSpecification",
      description: deal.discountValue,
    };
  }

  if (restaurantName || deal.restaurantName) {
    schema.seller = {
      "@type": "FoodEstablishment",
      name: restaurantName || deal.restaurantName,
    };
  }

  schema.availability = "https://schema.org/InStock";

  return schema;
}

/**
 * Generate VideoObject schema for recommendation videos
 */
export function generateVideoSchema(video: VideoRecommendation) {
  const schema: any = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    identifier: video.id,
    uploadDate: video.uploadDate,
  };

  if (video.description) {
    schema.description = video.description;
  }

  if (video.thumbnailUrl) {
    schema.thumbnailUrl = video.thumbnailUrl;
  }

  if (video.videoUrl) {
    schema.contentUrl = video.videoUrl;
  }

  if (video.duration) {
    // Convert seconds to ISO 8601 duration format (PT#S)
    schema.duration = `PT${video.duration}S`;
  }

  if (video.transcript) {
    schema.transcript = video.transcript;
  }

  if (video.creatorName) {
    schema.creator = {
      "@type": "Person",
      name: video.creatorName,
    };
  }

  return schema;
}

/**
 * Generate ItemList schema for listing pages (cuisine, location)
 */
export function generateItemListSchema(
  items: Array<{ id: string; name: string; url?: string }>,
  listName: string
) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.url && { url: item.url }),
    })),
  };
}

export function generatePlaceSchema(place: PlaceEntity) {
  const schema: any = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: place.name,
    identifier: place.id,
    ...(place.url ? { url: place.url } : {}),
  };

  if (place.address || place.city) {
    schema.address = {
      "@type": "PostalAddress",
      ...(place.address ? { streetAddress: place.address } : {}),
      ...(place.city ? { addressLocality: place.city } : {}),
      ...(place.state ? { addressRegion: place.state } : {}),
      addressCountry: "US",
    };
  }

  const lat = place.latitude != null ? Number(place.latitude) : null;
  const lng = place.longitude != null ? Number(place.longitude) : null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    schema.geo = {
      "@type": "GeoCoordinates",
      latitude: lat,
      longitude: lng,
    };
  }

  return schema;
}

export function generateEventSchema(event: EventEntity) {
  const schema: any = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    identifier: event.id,
    startDate: event.startDate,
    ...(event.url ? { url: event.url } : {}),
  };

  if (event.endDate) schema.endDate = event.endDate;
  if (event.description) schema.description = event.description;
  if (event.location) {
    schema.location = generatePlaceSchema(event.location);
  }

  return schema;
}

/**
 * Inject schema into page head
 */
export function injectSchema(schema: object) {
  if (typeof window === "undefined") return;

  const scriptId = "structured-data";
  let script = document.getElementById(scriptId) as HTMLScriptElement | null;

  if (!script) {
    const newScript = document.createElement("script");
    newScript.id = scriptId;
    newScript.type = "application/ld+json";
    document.head.appendChild(newScript);
    script = newScript;
  }

  script.textContent = JSON.stringify(schema);
}
