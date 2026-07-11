export type MealScoutEventInput = {
  entity_id: string;
  event_type:
    | 'restaurant_onboarded'
    | 'host_onboarded'
    | 'vendor_onboarded'
    | 'event_created'
    | 'event_application_started'
    | 'event_application_accepted'
    | 'parking_booking_started'
    | 'parking_booking_completed'
    | 'online_order_started'
    | 'online_order_completed'
    | 'menu_updated'
    | 'deal_created'
    | 'payment_completed'
    | 'order_failed'
    | 'payment_failed'
    | 'booking_abandoned'
    | 'profile_incomplete'
    | string;
  origin_surface?: string;
  observed_at?: string;
  payload?: Record<string, unknown>;
  restaurant_id?: string;
  host_id?: string;
  vendor_id?: string;
  event_id?: string;
  booking_id?: string;
  order_id?: string;
  business_id?: string;
  user_id?: string;
  restaurant_name?: string;
  host_name?: string;
  vendor_name?: string;
  location?: string;
  county?: string;
  city?: string;
};

type EmitResult = {
  emitted: boolean;
  skipped: boolean;
};

function isMerlinEnabled(): boolean {
  return String(process.env.MERLIN_OR_ENABLED || '').toLowerCase() === 'true';
}

function getMerlinEventsUrl(): string | null {
  const configuredUrl = (process.env.MERLIN_OR_EVENTS_URL || '').trim();
  return configuredUrl.length > 0 ? configuredUrl : null;
}

function buildEventPayload(event: MealScoutEventInput): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    entity_id: event.entity_id,
    event_type: event.event_type,
    origin_surface: 'mealscout',
    observed_at: event.observed_at || now,
    payload: event.payload || {},
    business_id: event.business_id || null,
    user_id: event.user_id || null,
    restaurant_id: event.restaurant_id || null,
    host_id: event.host_id || null,
    vendor_id: event.vendor_id || null,
    event_id: event.event_id || null,
    booking_id: event.booking_id || null,
    order_id: event.order_id || null,
    restaurant_name: event.restaurant_name || null,
    host_name: event.host_name || null,
    vendor_name: event.vendor_name || null,
    location: event.location || null,
    county: event.county || null,
    city: event.city || null
  };
}

export async function emitMealScoutEvent(event: MealScoutEventInput): Promise<EmitResult> {
  if (!isMerlinEnabled()) {
    console.log('[Merlin emitter] MERLIN_OR_ENABLED is not true; skipping emit.');
    return { emitted: false, skipped: true };
  }

  const eventsUrl = getMerlinEventsUrl();
  if (!eventsUrl) {
    console.log('[Merlin emitter] MERLIN_OR_EVENTS_URL not configured; skipping emit.');
    return { emitted: false, skipped: true };
  }

  const payload = buildEventPayload(event);

  try {
    const response = await fetch(eventsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => 'No response body');
      console.warn('[Merlin emitter] Failed to emit MealScout event to Merlin', {
        status: response.status,
        statusText: response.statusText,
        responseText
      });
      return { emitted: false, skipped: false };
    }
    return { emitted: true, skipped: false };
  } catch (error) {
    console.warn('[Merlin emitter] Failed to emit MealScout event to Merlin', error);
    return { emitted: false, skipped: false };
  }
}

export function buildMealScoutEventInput(event: {
  entity_id: string;
  event_type: MealScoutEventInput['event_type'];
  user?: { id?: string | null };
  restaurant?: { id?: string | null; name?: string | null; city?: string | null; county?: string | null };
  host?: { id?: string | null; name?: string | null; county?: string | null };
  vendor?: { id?: string | null; name?: string | null; city?: string | null };
  location?: string;
  city?: string;
  county?: string;
  payload?: Record<string, unknown>;
}): MealScoutEventInput {
  return {
    entity_id: event.entity_id,
    event_type: event.event_type,
    business_id: event.restaurant?.id || event.user?.id || undefined,
    user_id: event.user?.id || undefined,
    restaurant_id: event.restaurant?.id || undefined,
    restaurant_name: event.restaurant?.name || undefined,
    host_id: event.host?.id || undefined,
    host_name: event.host?.name || undefined,
    vendor_id: event.vendor?.id || undefined,
    vendor_name: event.vendor?.name || undefined,
    city: event.city || event.restaurant?.city || undefined,
    county: event.county || event.restaurant?.county || undefined,
    location: event.location || event.city || undefined,
    payload: event.payload || {}
  };
}
