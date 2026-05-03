import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import {
  CheckCircle,
  Truck,
  Radio,
  MapPin,
  Clock,
  Activity,
} from "lucide-react";
import { format } from "date-fns";
import {
  getCategoryLine,
  getLocationLine,
  resolveImageFallback,
  resolveListingImageUrl,
} from "@/lib/listing-card-display";

interface Restaurant {
  id: string;
  name: string;
  address: string;
  city?: string | null;
  state?: string | null;
  phone?: string;
  cuisineType?: string;
  businessType?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  facebookCoverUrl?: string | null;
  facebookPhotos?: unknown;
  googlePhotos?: unknown;
  rating?: number | null;
  operatingHours?: unknown;
  isActive?: boolean;
  isVerified?: boolean;
  isFoodTruck?: boolean;
  mobileOnline?: boolean;
  currentLatitude?: number;
  currentLongitude?: number;
  lastBroadcastAt?: string;
  distance?: number;
}

interface RestaurantCardProps {
  restaurant: Restaurant;
  userLocation?: { lat: number; lng: number } | null;
  showDistance?: boolean;
}

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const getHoursPreview = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "object") {
    const hours = value as Record<string, unknown>;
    const dayOrder = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    for (const day of dayOrder) {
      const slot = hours[day];
      if (!slot) continue;
      if (typeof slot === "string") {
        const s = slot.trim();
        if (s) return s;
      }
      if (Array.isArray(slot) && slot.length > 0) {
        const first = String(slot[0] || "").trim();
        if (first) return first;
      }
      if (typeof slot === "object") {
        const fromTo =
          (slot as any)?.from && (slot as any)?.to
            ? `${String((slot as any).from)}-${String((slot as any).to)}`
            : "";
        if (fromTo) return fromTo;
      }
    }
  }

  return null;
};

export default function RestaurantCard({
  restaurant,
  userLocation,
  showDistance = false,
}: RestaurantCardProps) {
  // Calculate distance if user location is available
  const calculateDistance = (
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ) => {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
  };

  const distance =
    userLocation && restaurant.currentLatitude && restaurant.currentLongitude
      ? calculateDistance(
          userLocation.lat,
          userLocation.lng,
          Number(restaurant.currentLatitude),
          Number(restaurant.currentLongitude),
        )
      : restaurant.distance;

  const isLiveFoodTruck = Boolean(
    restaurant.isFoodTruck && restaurant.mobileOnline && restaurant.isActive,
  );
  const isRecentlyActive =
    restaurant.lastBroadcastAt &&
    Date.now() - new Date(restaurant.lastBroadcastAt).getTime() < 300000; // 5 minutes
  const rating =
    typeof restaurant.rating === "number" && Number.isFinite(restaurant.rating)
      ? Math.max(0, Math.min(5, restaurant.rating))
      : null;
  const hoursPreview = getHoursPreview(restaurant.operatingHours);
  const profileSlug = toSlug(restaurant.name) || String(restaurant.id || "");
  const imageUrl = resolveListingImageUrl(restaurant);
  const categoryLine = getCategoryLine(restaurant);
  const locationLine = getLocationLine(restaurant);

  return (
    <Link href={`/restaurant/${restaurant.id}/${profileSlug}`}>
      <Card
        className={`group bg-card border rounded-xl overflow-hidden shadow-clean hover:shadow-clean-lg transition-all duration-200 cursor-pointer ${
          restaurant.isFoodTruck
            ? "border-orange-200 hover:border-orange-300"
            : "border-border"
        } ${isLiveFoodTruck ? "ring-2 ring-orange-200 ring-opacity-50" : ""}`}
        data-testid={`card-restaurant-${restaurant.id}`}
      >
        <CardContent className="p-0">
          <div className="relative h-36 overflow-hidden bg-muted">
            <img
              src={imageUrl}
              alt={`${restaurant.name} photo`}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(event) => resolveImageFallback(event, restaurant)}
              data-testid={`image-restaurant-${restaurant.id}`}
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3">
              <div className="flex min-w-0 items-end justify-between gap-2">
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-semibold text-white"
                    data-testid={`text-restaurant-name-${restaurant.id}`}
                  >
                    {restaurant.name}
                  </p>
                  <p
                    className="truncate text-xs text-white/85"
                    data-testid={`text-restaurant-cuisine-${restaurant.id}`}
                  >
                    {categoryLine}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {restaurant.isVerified && (
                    <CheckCircle
                      className="h-4 w-4 text-emerald-300"
                      data-testid={`icon-verified-${restaurant.id}`}
                    />
                  )}
                  {restaurant.isFoodTruck && (
                    <Truck
                      className="h-4 w-4 text-orange-200"
                      data-testid={`icon-food-truck-${restaurant.id}`}
                    />
                  )}
                </div>
              </div>
            </div>
            {isLiveFoodTruck && (
              <div
                className="absolute right-2 top-2 z-10 flex items-center rounded-full bg-gradient-to-r from-orange-500 to-red-500 px-2 py-1 text-xs font-bold text-white shadow-clean-lg animate-pulse"
                data-testid={`badge-live-${restaurant.id}`}
              >
                <Radio className="w-3 h-3 mr-1" />
                LIVE
              </div>
            )}
          </div>

          <div className="p-4">
            <div className="mb-2">
              <div className="mb-1 flex items-center gap-2">
                {restaurant.isFoodTruck && (
                  <span
                    className="text-xs bg-orange-100 text-orange-600 px-1 py-0.5 rounded"
                    data-testid={`label-food-truck-${restaurant.id}`}
                  >
                    Mobile
                  </span>
                )}
              </div>
              <p
                className="flex items-start gap-1 text-xs text-muted-foreground"
                data-testid={`text-restaurant-address-${restaurant.id}`}
              >
                <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="line-clamp-2">{locationLine}</span>
              </p>
              {hoursPreview && (
                <p
                  className="mt-1 text-xs text-muted-foreground flex items-center gap-1"
                  data-testid={`text-restaurant-hours-${restaurant.id}`}
                >
                  <Clock className="w-3 h-3" />
                  <span>{hoursPreview}</span>
                </p>
              )}
            </div>

            {/* Food Truck Specific Info */}
            {restaurant.isFoodTruck &&
              (showDistance || distance || restaurant.lastBroadcastAt) && (
              <div
                className="bg-orange-50 border border-orange-200 rounded-lg p-2 mb-3"
                data-testid={`food-truck-info-${restaurant.id}`}
              >
                <div className="flex items-center justify-between text-xs">
                  {distance && (
                    <div className="flex items-center text-orange-600">
                      <MapPin className="w-3 h-3 mr-1" />
                      <span data-testid={`text-distance-${restaurant.id}`}>
                        {distance < 1
                          ? `${Math.round(distance * 1000)}m`
                          : `${distance.toFixed(1)}km`}{" "}
                        away
                      </span>
                    </div>
                  )}
                  {restaurant.lastBroadcastAt && (
                    <div className="flex items-center text-orange-600">
                      <Clock className="w-3 h-3 mr-1" />
                      <span data-testid={`text-last-seen-${restaurant.id}`}>
                        {isRecentlyActive
                          ? "Active now"
                          : `Last seen ${format(new Date(restaurant.lastBroadcastAt), "HH:mm")}`}
                      </span>
                    </div>
                  )}
                </div>
                {isLiveFoodTruck && (
                  <div className="flex items-center mt-1 text-xs text-orange-700">
                    <Activity className="w-3 h-3 mr-1 animate-pulse" />
                    <span data-testid={`text-broadcasting-${restaurant.id}`}>
                      Broadcasting live location
                  </span>
                </div>
              )}
              </div>
            )}

            {(rating != null ||
              (restaurant.isFoodTruck && distance) ||
              isLiveFoodTruck) && (
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center space-x-4">
                  {rating != null && (
                    <div className="flex items-center space-x-1">
                      <i className="fas fa-star text-yellow-400 text-xs"></i>
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid={`text-rating-${restaurant.id}`}
                      >
                        {rating.toFixed(1)}
                      </span>
                    </div>
                  )}
                  {restaurant.isFoodTruck && distance && (
                    <div className="flex items-center space-x-1">
                      <MapPin className="w-3 h-3 text-muted-foreground" />
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid={`text-truck-distance-${restaurant.id}`}
                      >
                        {distance < 1
                          ? `${Math.round(distance * 1000)}m`
                          : `${distance.toFixed(1)}km`}
                      </span>
                    </div>
                  )}
                </div>
                {isLiveFoodTruck ? (
                  <div
                    className="px-2 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-green-500 to-emerald-500 text-white animate-pulse"
                    data-testid={`status-${restaurant.id}`}
                  >
                    LIVE
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
