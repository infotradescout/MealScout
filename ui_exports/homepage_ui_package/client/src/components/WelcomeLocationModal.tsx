import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Navigation, Search } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";

interface WelcomeLocationModalProps {
  open: boolean;
  onLocationSet: (
    location: { lat: number; lng: number },
    locationName: string
  ) => void;
  onSkip: () => void;
}

export default function WelcomeLocationModal({
  open,
  onLocationSet,
  onSkip,
}: WelcomeLocationModalProps) {
  const [isDetecting, setIsDetecting] = useState(false);
  const [manualLocation, setManualLocation] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  const isTruckSideUser =
    user &&
    (user.userType === "restaurant_owner" ||
      user.userType === "staff" ||
      user.userType === "admin");

  const handleAutoDetect = async () => {
    setIsDetecting(true);
    setError(null);

    if (!navigator.geolocation) {
      setError("Location services not available in your browser");
      setIsDetecting(false);
      return;
    }

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 8000,
            maximumAge: 0,
          });
        }
      );

      const newLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      // Reverse geocode to get location name
      try {
        const response = await fetch(
          `/api/location/reverse?lat=${encodeURIComponent(String(newLocation.lat))}&lng=${encodeURIComponent(String(newLocation.lng))}`
        );
        const data = await response.json();
        const locationName = String(data?.label || "Your Location");
        onLocationSet(newLocation, locationName);
      } catch {
        onLocationSet(newLocation, "Your Location");
      }
    } catch (error: any) {
      setError(
        "Unable to detect your location. Please enter it manually or skip."
      );
    } finally {
      setIsDetecting(false);
    }
  };

  const handleManualSearch = async () => {
    if (!manualLocation.trim()) return;

    setIsSearching(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/location/search?q=${encodeURIComponent(
          manualLocation
        )}&limit=1`
      );
      const data = await response.json();

      if (data && data[0]) {
        const newLocation = {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
        };
        const locationName = data[0].display_name.split(",")[0];
        onLocationSet(newLocation, locationName);
      } else {
        setError("Location not found. Try a different city or zip code.");
      }
    } catch {
      setError("Failed to search for location. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onSkip()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            {isTruckSideUser
              ? "Find food truck spots"
              : "Welcome to MealScout!"}
          </DialogTitle>
          <DialogDescription className="text-center text-base">
            {isTruckSideUser
              ? "Use your location to discover hosts, events, and neighborhoods looking for food trucks. We'll still surface deals when trucks post them."
              : "Discover nearby food trucks, pop-ups, and local meal deals near you."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Auto-detect option */}
          <Button
            onClick={handleAutoDetect}
            disabled={isDetecting}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white h-12"
          >
            {isDetecting ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Detecting...</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Navigation className="w-5 h-5" />
                <span>Use My Current Location</span>
              </div>
            )}
          </Button>

          {/* Divider */}
          <div className="relative pt-1">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 py-0.5 text-muted-foreground">
                Or enter manually
              </span>
            </div>
          </div>

          {/* Manual search */}
          <div className="space-y-2 pt-1">
            <div className="flex space-x-2">
              <Input
                placeholder="Enter city or zip code..."
                value={manualLocation}
                onChange={(e) => setManualLocation(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleManualSearch()}
                className="flex-1"
              />
              <Button
                onClick={handleManualSearch}
                disabled={isSearching || !manualLocation.trim()}
                variant="outline"
                className="px-4"
              >
                {isSearching ? (
                  <div className="w-4 h-4 border-2 border-[var(--border-strong)] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </Button>
            </div>

            {error && <p className="text-sm text-[color:var(--status-error)]">{error}</p>}
          </div>

          {/* Skip option */}
          <Button
            onClick={onSkip}
            variant="ghost"
            className="w-full text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
          >
            Skip for now
          </Button>

          {!user && (
            <Button asChild className="w-full">
              <Link href="/customer-signup">Create account</Link>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


