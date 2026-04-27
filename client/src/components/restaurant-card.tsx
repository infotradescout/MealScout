import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Truck, Radio, MapPin, Clock, Activity } from "lucide-react";
import { format } from "date-fns";

interface Restaurant {
  id: string;
  name: string;
  address: string;
  phone?: string;
  cuisineType?: string;
  rating?: number | null;
  operatingHours?: unknown;
  isActive: boolean;
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
        const fromTo = (slot as any)?.from && (slot as any)?.to
          ? `${String((slot as any).from)}-${String((slot as any).to)}`
          : "";
        if (fromTo) return fromTo;
      }
    }
  }

  return null;
};

export default function RestaurantCard({ restaurant, userLocation, showDistance = false }: RestaurantCardProps) {
  // Calculate distance if user location is available
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
  };

  const distance = userLocation && restaurant.currentLatitude && restaurant.currentLongitude
    ? calculateDistance(
        userLocation.lat,
        userLocation.lng,
        Number(restaurant.currentLatitude),
        Number(restaurant.currentLongitude)
      )
    : restaurant.distance;

  const isLiveFoodTruck = restaurant.isFoodTruck && restaurant.mobileOnline && restaurant.isActive;
  const isRecentlyActive = restaurant.lastBroadcastAt && 
    (Date.now() - new Date(restaurant.lastBroadcastAt).getTime()) < 300000; // 5 minutes
  const rating =
    typeof restaurant.rating === "number" && Number.isFinite(restaurant.rating)
      ? Math.max(0, Math.min(5, restaurant.rating))
      : null;
  const hoursPreview = getHoursPreview(restaurant.operatingHours);
  const profileSlug = toSlug(restaurant.name) || String(restaurant.id || "");
  return (
    <Link href={`/restaurant/${restaurant.id}/${profileSlug}`}>
      <Card className={`bg-card border rounded-xl overflow-hidden shadow-clean hover:shadow-clean-lg transition-all duration-200 cursor-pointer ${
        restaurant.isFoodTruck ? 'border-orange-200 hover:border-orange-300' : 'border-border'
      } ${isLiveFoodTruck ? 'ring-2 ring-orange-200 ring-opacity-50' : ''}`} 
      data-testid={`card-restaurant-${restaurant.id}`}>
        <CardContent className="p-4 relative">
          {/* Food Truck Live Badge */}
          {isLiveFoodTruck && (
            <div className="absolute top-2 right-2 z-10">
              <div className="flex items-center bg-gradient-to-r from-orange-500 to-red-500 text-white px-2 py-1 rounded-full text-xs font-bold shadow-clean-lg animate-pulse" data-testid={`badge-live-${restaurant.id}`}>
                <Radio className="w-3 h-3 mr-1" />
                LIVE
              </div>
            </div>
          )}

          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <h3 className="font-semibold text-foreground mb-1 flex items-center space-x-2" data-testid={`text-restaurant-name-${restaurant.id}`}>
                <span>{restaurant.name}</span>
                {restaurant.isVerified && (
                  <CheckCircle className="w-4 h-4 text-[color:var(--status-success)]" data-testid={`icon-verified-${restaurant.id}`} />
                )}
                {restaurant.isFoodTruck && (
                  <Truck className="w-4 h-4 text-orange-500" data-testid={`icon-food-truck-${restaurant.id}`} />
                )}
              </h3>
              <div className="flex items-center space-x-2 mb-1">
                <p className="text-xs text-muted-foreground" data-testid={`text-restaurant-cuisine-${restaurant.id}`}>
                  {restaurant.cuisineType || (restaurant.isFoodTruck ? "Food Truck" : "Restaurant")}
                </p>
                {restaurant.isFoodTruck && (
                  <span className="text-xs bg-orange-100 text-orange-600 px-1 py-0.5 rounded" data-testid={`label-food-truck-${restaurant.id}`}>
                    Mobile
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground" data-testid={`text-restaurant-address-${restaurant.id}`}>
                {restaurant.address}
              </p>
              {hoursPreview && (
                <p className="mt-1 text-xs text-muted-foreground flex items-center gap-1" data-testid={`text-restaurant-hours-${restaurant.id}`}>
                  <Clock className="w-3 h-3" />
                  <span>{hoursPreview}</span>
                </p>
              )}
            </div>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
              restaurant.isFoodTruck ? 'bg-gradient-to-r from-orange-500 to-red-500' : 'bg-primary'
            }`}>
              {restaurant.isFoodTruck ? (
                <Truck className="w-5 h-5 text-white" />
              ) : (
                <i className="fas fa-utensils text-white"></i>
              )}
            </div>
          </div>
          
          {/* Food Truck Specific Info */}
          {restaurant.isFoodTruck && (showDistance || distance || restaurant.lastBroadcastAt) && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 mb-3" data-testid={`food-truck-info-${restaurant.id}`}>
              <div className="flex items-center justify-between text-xs">
                {distance && (
                  <div className="flex items-center text-orange-600">
                    <MapPin className="w-3 h-3 mr-1" />
                    <span data-testid={`text-distance-${restaurant.id}`}>
                      {distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`} away
                    </span>
                  </div>
                )}
                {restaurant.lastBroadcastAt && (
                  <div className="flex items-center text-orange-600">
                    <Clock className="w-3 h-3 mr-1" />
                    <span data-testid={`text-last-seen-${restaurant.id}`}>
                      {isRecentlyActive ? 'Active now' : `Last seen ${format(new Date(restaurant.lastBroadcastAt), 'HH:mm')}`}
                    </span>
                  </div>
                )}
              </div>
              {isLiveFoodTruck && (
                <div className="flex items-center mt-1 text-xs text-orange-700">
                  <Activity className="w-3 h-3 mr-1 animate-pulse" />
                  <span data-testid={`text-broadcasting-${restaurant.id}`}>Broadcasting live location</span>
                </div>
              )}
            </div>
          )}
          
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-1">
                <i className="fas fa-star text-yellow-400 text-xs"></i>
                <span className="text-xs text-muted-foreground" data-testid={`text-rating-${restaurant.id}`}>
                  {rating != null ? rating.toFixed(1) : "N/A"}
                </span>
              </div>
              {restaurant.isFoodTruck && distance && (
                <div className="flex items-center space-x-1">
                  <MapPin className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground" data-testid={`text-truck-distance-${restaurant.id}`}>
                    {distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`}
                  </span>
                </div>
              )}
            </div>
            <div className={`px-2 py-1 rounded-full text-xs font-medium ${
              isLiveFoodTruck 
                ? "bg-gradient-to-r from-green-500 to-emerald-500 text-white animate-pulse" 
                : restaurant.isActive 
                ? "bg-accent/20 text-accent" 
                : "bg-muted text-muted-foreground"
            }`} data-testid={`status-${restaurant.id}`}>
              {isLiveFoodTruck ? "LIVE" : restaurant.isActive ? "Open" : "Closed"}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

