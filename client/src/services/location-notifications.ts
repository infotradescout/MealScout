import { apiRequest } from "@/lib/queryClient";
import {
  DEVICE_LOCATION_STORAGE_KEY,
  readDeviceLocation,
  writeDeviceLocation,
} from "@/lib/device-location";

export interface NotificationSettings {
  enabled: boolean;
  radius: number; // in kilometers
  categories: string[];
  quietHours: { start: string; end: string };
  maxPerDay: number;
}

export interface Deal {
  id: string;
  title: string;
  description: string;
  restaurantName: string;
  discountValue: string;
  imageUrl?: string;
  distance: number;
}

const STORAGE_KEYS = {
  SETTINGS: "mealscout_notification_settings",
  LAST_LOCATION: DEVICE_LOCATION_STORAGE_KEY,
  SHOWN_DEALS: "mealscout_shown_deals",
  SHOWN_EVENTS: "mealscout_shown_events",
  DAILY_COUNT: "mealscout_daily_count",
};

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  radius: 1, // 1km default
  categories: [], // empty means all categories
  quietHours: { start: "22:00", end: "08:00" },
  maxPerDay: 5,
};

class LocationNotificationService {
  private watchId: number | null = null;
  private lastLocation: { lat: number; lng: number; timestamp: number } | null =
    null;
  private isMonitoring = false;
  private shownDealsToday = new Set<string>();
  private shownEventsToday = new Set<string>();
  private dailyCount = 0;

  constructor() {
    this.loadStoredData();
    this.resetDailyCountIfNeeded();
  }

  private loadStoredData() {
    try {
      const lastLocation = readDeviceLocation();
      if (lastLocation) {
        this.lastLocation = lastLocation;
      }

      const shownDeals = localStorage.getItem(STORAGE_KEYS.SHOWN_DEALS);
      if (shownDeals) {
        this.shownDealsToday = new Set(JSON.parse(shownDeals));
      }

      const shownEvents = localStorage.getItem(STORAGE_KEYS.SHOWN_EVENTS);
      if (shownEvents) {
        this.shownEventsToday = new Set(JSON.parse(shownEvents));
      }

      const dailyCount = localStorage.getItem(STORAGE_KEYS.DAILY_COUNT);
      if (dailyCount) {
        this.dailyCount = parseInt(dailyCount);
      }
    } catch {
      // Ignore errors
    }
  }

  private resetDailyCountIfNeeded() {
    const today = new Date().toDateString();
    const lastReset = localStorage.getItem("mealscout_last_reset");

    if (lastReset !== today) {
      this.shownDealsToday.clear();
      this.shownEventsToday.clear();
      this.dailyCount = 0;
      localStorage.setItem("mealscout_last_reset", today);
      localStorage.setItem(STORAGE_KEYS.SHOWN_DEALS, "[]");
      localStorage.setItem(STORAGE_KEYS.SHOWN_EVENTS, "[]");
      localStorage.setItem(STORAGE_KEYS.DAILY_COUNT, "0");
    }
  }

  getSettings(): NotificationSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // Ignore errors
    }
    return DEFAULT_SETTINGS;
  }

  updateSettings(settings: Partial<NotificationSettings>) {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));

    // Restart monitoring if settings changed
    if (this.isMonitoring) {
      this.stopMonitoring();
      this.startMonitoring();
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!("Notification" in window)) {
      console.log("This browser does not support notifications");
      return false;
    }

    if (Notification.permission === "granted") {
      return true;
    }

    if (Notification.permission !== "denied") {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    }

    return false;
  }

  async startMonitoring() {
    const settings = this.getSettings();

    if (!settings.enabled || !navigator.geolocation) {
      return;
    }

    const hasPermission = await this.requestPermission();
    if (!hasPermission) {
      console.log("Notification permission not granted");
      return;
    }

    this.isMonitoring = true;

    // Watch for location changes
    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handleLocationUpdate(position),
      (error) => console.error("Location error:", error),
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 60 * 1000, // 1 minute for better accuracy
      }
    );

    console.log("📍 Started location monitoring for deal notifications");
  }

  stopMonitoring() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isMonitoring = false;
    console.log("📍 Stopped location monitoring");
  }

  private async handleLocationUpdate(position: GeolocationPosition) {
    const { latitude: lat, longitude: lng } = position.coords;
    const now = Date.now();

    // Check if we've moved significantly or enough time has passed
    const shouldCheck =
      !this.lastLocation ||
      this.hasMoved(lat, lng, this.lastLocation) ||
      now - this.lastLocation.timestamp > 10 * 60 * 1000; // 10 minutes

    if (!shouldCheck) return;

    this.lastLocation = { lat, lng, timestamp: now };
    writeDeviceLocation(this.lastLocation);

    // Check for nearby deals and events
    await Promise.all([
      this.checkNearbyDeals(lat, lng),
      this.checkNearbyEvents(lat, lng),
    ]);
  }

  private hasMoved(
    lat1: number,
    lng1: number,
    lastLocation: { lat: number; lng: number }
  ): boolean {
    const distance = this.calculateDistance(
      lat1,
      lng1,
      lastLocation.lat,
      lastLocation.lng
    );
    return distance > 0.1; // 100 meters
  }

  private calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private async checkNearbyDeals(lat: number, lng: number) {
    const settings = this.getSettings();

    // Check if we're in quiet hours
    if (this.isQuietTime(settings.quietHours)) {
      return;
    }

    // Check daily limit
    if (this.dailyCount >= settings.maxPerDay) {
      return;
    }

    try {
      const nearbyDeals = (await apiRequest(
        "GET",
        `/api/deals/nearby/${lat}/${lng}?radius=${settings.radius}`
      )) as unknown as Deal[];

      // Filter deals we haven't shown today
      const newDeals = nearbyDeals.filter(
        (deal) =>
          !this.shownDealsToday.has(deal.id) &&
          this.matchesCategories(deal, settings.categories)
      );

      // Show notifications for new deals
      for (const deal of newDeals.slice(
        0,
        settings.maxPerDay - this.dailyCount
      )) {
        await this.showNotification(deal);
        this.markDealAsShown(deal.id);
        this.dailyCount++;
      }

      // Update stored counts
      localStorage.setItem(
        STORAGE_KEYS.DAILY_COUNT,
        this.dailyCount.toString()
      );
      localStorage.setItem(
        STORAGE_KEYS.SHOWN_DEALS,
        JSON.stringify(Array.from(this.shownDealsToday))
      );
    } catch (error) {
      console.error("Failed to check nearby deals:", error);
    }
  }

  private async checkNearbyEvents(lat: number, lng: number) {
    const settings = this.getSettings();

    // Respect quiet hours and daily cap (shared with deals)
    if (this.isQuietTime(settings.quietHours)) {
      return;
    }

    if (this.dailyCount >= settings.maxPerDay) {
      return;
    }

    try {
      // Reuse public map feed for upcoming events
      const response = await apiRequest("GET", "/api/map/locations");

      const { eventLocations } = (response || {}) as {
        eventLocations?: Array<{
          id: string;
          name: string;
          date: string;
          startTime: string;
          endTime: string;
          status: string;
          hostName?: string | null;
          hostAddress?: string | null;
          hostLatitude?: number | string | null;
          hostLongitude?: number | string | null;
        }>;
      };

      if (!eventLocations || eventLocations.length === 0) {
        return;
      }

      // 10 miles ≈ 16.1 km
      const EVENT_RADIUS_KM = 16.1;

      const candidates = eventLocations.filter((event) => {
        if (event.status !== "open") return false;

        const hostLatRaw = event.hostLatitude;
        const hostLngRaw = event.hostLongitude;
        if (hostLatRaw == null || hostLngRaw == null) return false;

        const hostLat =
          typeof hostLatRaw === "string" ? parseFloat(hostLatRaw) : hostLatRaw;
        const hostLng =
          typeof hostLngRaw === "string" ? parseFloat(hostLngRaw) : hostLngRaw;
        if (Number.isNaN(hostLat) || Number.isNaN(hostLng)) return false;

        const distanceKm = this.calculateDistance(lat, lng, hostLat, hostLng);
        return distanceKm <= EVENT_RADIUS_KM;
      });

      const newEvents = candidates.filter(
        (event) => !this.shownEventsToday.has(event.id)
      );

      for (const event of newEvents.slice(
        0,
        settings.maxPerDay - this.dailyCount
      )) {
        await this.showEventNotification(event);
        this.markEventAsShown(event.id);
        this.dailyCount++;
      }

      localStorage.setItem(
        STORAGE_KEYS.DAILY_COUNT,
        this.dailyCount.toString()
      );
      localStorage.setItem(
        STORAGE_KEYS.SHOWN_EVENTS,
        JSON.stringify(Array.from(this.shownEventsToday))
      );
    } catch (error) {
      console.error("Failed to check nearby events:", error);
    }
  }

  private isQuietTime(quietHours: { start: string; end: string }): boolean {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = quietHours.start.split(":").map(Number);
    const [endHour, endMin] = quietHours.end.split(":").map(Number);

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    if (startTime <= endTime) {
      // Same day quiet hours (e.g., 22:00 to 23:00)
      return currentTime >= startTime && currentTime <= endTime;
    } else {
      // Overnight quiet hours (e.g., 22:00 to 08:00)
      return currentTime >= startTime || currentTime <= endTime;
    }
  }

  private matchesCategories(deal: Deal, categories: string[]): boolean {
    if (categories.length === 0) return true; // No filter means all categories

    // This would need to be enhanced based on how we store restaurant categories
    return true; // For now, allow all deals
  }

  private async showNotification(deal: Deal) {
    if (Notification.permission !== "granted") return;

    const notification = new Notification(`🍽️ New Deal Nearby!`, {
      body: `${deal.restaurantName}: ${deal.title}\n${
        deal.discountValue
      }% OFF • ${deal.distance.toFixed(1)}km away`,
      icon: deal.imageUrl || "/favicon.ico",
      tag: `deal-${deal.id}`,
      requireInteraction: false,
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      window.location.href = `/deal/${deal.id}`;
      notification.close();
    };

    // Auto-close after 5 seconds
    setTimeout(() => notification.close(), 5000);
  }

  private markDealAsShown(dealId: string) {
    this.shownDealsToday.add(dealId);
  }

  private async showEventNotification(event: {
    id: string;
    name: string;
    date: string;
    startTime: string;
    endTime: string;
    hostName?: string | null;
    hostAddress?: string | null;
  }) {
    if (Notification.permission !== "granted") return;

    const when = `${new Date(event.date).toLocaleDateString()} • ${
      event.startTime
    } - ${event.endTime}`;

    const title = "📅 Food truck event near you";
    const bodyLines = [
      event.name,
      event.hostName ? `Host: ${event.hostName}` : null,
      event.hostAddress || null,
      when,
    ].filter(Boolean) as string[];

    const notification = new Notification(title, {
      body: bodyLines.join("\n"),
      icon: "/icons/event-badge.png",
      tag: `event-${event.id}`,
      requireInteraction: false,
      silent: false,
    });

    notification.onclick = () => {
      window.focus();
      window.location.href = `/truck-discovery?eventId=${event.id}`;
      notification.close();
    };

    setTimeout(() => notification.close(), 7000);
  }

  private markEventAsShown(eventId: string) {
    this.shownEventsToday.add(eventId);
  }

  isMonitoringActive(): boolean {
    return this.isMonitoring;
  }

  getCurrentLocation(): { lat: number; lng: number } | null {
    return this.lastLocation
      ? { lat: this.lastLocation.lat, lng: this.lastLocation.lng }
      : null;
  }

  getTodayStats() {
    return {
      notificationsShown: this.dailyCount,
      maxAllowed: this.getSettings().maxPerDay,
      dealsShown: this.shownDealsToday.size,
    };
  }
}

// Export singleton instance
export const locationNotificationService = new LocationNotificationService();
