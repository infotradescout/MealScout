import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { apiUrl } from "@/lib/api";

export type BookingReturnOutcome = "confirmed" | "credited" | "pending" | "unknown";

// A redirect flag, a missing response, and a failed read are not payment proof.
export function bookingReturnOutcome(payload: unknown): BookingReturnOutcome {
  if (!payload || typeof payload !== "object") return "unknown";
  const status = (payload as { status?: unknown }).status;
  return status === "confirmed" || status === "credited" || status === "pending"
    ? status
    : "unknown";
}

export function parkingReturnQuery(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("payment_intent_client_secret");
  return params.toString();
}

// Login already validates internal redirects. Keep the same booking reference
// without forwarding the Stripe client secret or accepting an external target.
export function parkingLoginHref(search: string): string {
  const query = parkingReturnQuery(search);
  const destination = `/parking-pass${query ? `?${query}` : ""}`;
  return `/login?${new URLSearchParams({ redirect: destination }).toString()}`;
}

export function parkingScheduleHref(search: string, truckId: string): string {
  const params = new URLSearchParams(parkingReturnQuery(search));
  params.delete("booking");
  params.delete("payment_intent");
  params.delete("redirect_status");
  params.delete("setup");
  params.set("tab", "schedule");
  if (truckId) params.set("truckId", truckId);
  return `/parking-pass?${params.toString()}`;
}

const outcomeCopy: Record<BookingReturnOutcome, { title: string; description: string }> = {
  confirmed: {
    title: "Your booking is confirmed",
    description: "The booking service confirmed this reservation. View My Schedule for the host, date and selected slot.",
  },
  credited: {
    title: "Booking unavailable — credits issued",
    description: "The booking service reports that the spot could not be reserved and credits were issued. This is not a confirmed reservation.",
  },
  pending: {
    title: "Booking confirmation pending",
    description: "Confirmation is not final. Keep this page and check the same booking again before starting another payment.",
  },
  unknown: {
    title: "Booking status could not be verified",
    description: "We could not verify the payment or reservation. Your booking reference is still in this page address. Retry the status check before paying again.",
  },
};

type TruckChoice = { id: string; name: string };

export function ParkingPassBookingReturn({ search }: { search: string }) {
  const { user, isLoading } = useAuth();
  const params = new URLSearchParams(search);
  const intentId = String(params.get("payment_intent") || "").trim();
  const requestedTruckId = String(params.get("truckId") || "").trim();
  return (
    <BookingReturnSession
      key={JSON.stringify([user?.id, intentId, requestedTruckId])}
      search={search}
      intentId={intentId}
      requestedTruckId={requestedTruckId}
      signedIn={Boolean(user)}
      authLoading={isLoading}
    />
  );
}

function BookingReturnSession({ search, intentId, requestedTruckId, signedIn, authLoading }: {
  search: string;
  intentId: string;
  requestedTruckId: string;
  signedIn: boolean;
  authLoading: boolean;
}) {
  const [, navigate] = useLocation();
  const [trucks, setTrucks] = useState<TruckChoice[]>([]);
  const [truckId, setTruckId] = useState("");
  const [accessLoading, setAccessLoading] = useState(signedIn);
  const [accessError, setAccessError] = useState(false);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [outcome, setOutcome] = useState<BookingReturnOutcome>("unknown");
  const [checking, setChecking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const checkingRef = useRef(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Remove the client secret, but retain the intent and return marker until
    // the user chooses to leave. Reload and Back can recheck the same booking.
    if (!new URLSearchParams(window.location.search).has("payment_intent_client_secret")) return;
    const query = parkingReturnQuery(window.location.search);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setAccessLoading(true);
    setAccessError(false);
    void (async () => {
      try {
        const response = await fetch(apiUrl("/api/restaurants/my-restaurants"), {
          credentials: "include", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Business access unavailable");
        const data: unknown = await response.json();
        if (!current) return;
        if (!Array.isArray(data)) throw new Error("Business access response invalid");
        const choices = data.filter((value) => value && typeof value.id === "string" &&
          (value.isFoodTruck === true || String(value.businessType || "").toLowerCase() === "food_truck"))
          .map((value) => ({ id: value.id as string, name: String(value.name || "Food truck") }));
        setTrucks(choices);
        const requested = choices.find((value) => value.id === requestedTruckId);
        // Multiple trucks require an explicit selection. Never guess which
        // truck owns a returned intent or send an inaccessible ID to the API.
        setTruckId(requested?.id || (!requestedTruckId && choices.length === 1 ? choices[0].id : ""));
      } catch {
        if (current) { setAccessError(true); setTrucks([]); setTruckId(""); }
      } finally {
        window.clearTimeout(timeout);
        if (current) setAccessLoading(false);
      }
    })();
    return () => { current = false; window.clearTimeout(timeout); controller.abort(); };
  }, [signedIn, requestedTruckId, accessAttempt]);

  useEffect(() => {
    if (!signedIn || !intentId || !truckId) return;
    let current = true;
    const controller = new AbortController();
    checkingRef.current = true;
    setChecking(true);
    setOutcome("unknown");
    setMessage("");
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const response = await fetch(apiUrl(`/api/bookings/payment-intent/${encodeURIComponent(intentId)}?truckId=${encodeURIComponent(truckId)}`), {
          credentials: "include", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Booking status unavailable");
        const payload: unknown = await response.json();
        if (current) setOutcome(bookingReturnOutcome(payload));
      } catch {
        if (current) {
          setOutcome("unknown");
          setMessage(controller.signal.aborted
            ? "The status check timed out. Retry the existing booking; do not submit another payment."
            : "The status check failed. Check your connection and retry this booking.");
        }
      } finally {
        window.clearTimeout(timeout);
        if (current) { checkingRef.current = false; setChecking(false); }
      }
    })();
    return () => { current = false; checkingRef.current = false; window.clearTimeout(timeout); controller.abort(); };
  }, [signedIn, intentId, truckId, attempt]);

  const title = authLoading || accessLoading ? "Checking your booking access"
    : checking ? "Checking your booking"
    : !signedIn ? "Sign in to check this booking"
    : !intentId ? "Booking reference missing"
    : accessError ? "Truck access could not be loaded"
    : !truckId ? "Choose the truck used for checkout"
    : outcomeCopy[outcome].title;
  const scheduleHref = parkingScheduleHref(search, truckId);

  return (
    <main className="parking-pass-page mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:py-10">
      <p className="mb-2 text-sm font-semibold text-[color:var(--text-muted)]">Parking Pass</p>
      <Card>
        <CardContent className="space-y-4 p-5 sm:p-6" aria-busy={checking || accessLoading || authLoading}>
          <div role="status" aria-live="polite" aria-atomic="true">
            <h1 className="text-2xl font-bold text-[color:var(--text-primary)]">{title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-[color:var(--text-secondary)]">
              {authLoading || accessLoading ? "Checking access before looking up the reservation."
                : !signedIn ? "Use the account that booked the spot. Keep this page address so you can return to the same booking."
                : !intentId ? "No payment reference was returned. Check My Schedule before starting another payment."
                : accessError ? "Retry the truck lookup. No payment or booking has been changed by this check."
                : !truckId ? "Select the food truck that made this booking. Only trucks available to your account are listed."
                : checking ? "Checking the existing reservation. This does not submit another payment."
                : outcomeCopy[outcome].description}
            </p>
          </div>
          {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
          {signedIn && !accessLoading && trucks.length > 0 ? (
            <div>
              <label htmlFor="booking-return-truck" className="mb-2 block text-sm font-semibold">Truck for this booking</label>
              <select id="booking-return-truck" value={truckId} disabled={checking}
                className="min-h-11 w-full rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-base"
                onChange={(event) => { setOutcome("unknown"); setMessage(""); setTruckId(event.target.value); }}>
                <option value="">Choose your truck</option>
                {trucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.name}</option>)}
              </select>
            </div>
          ) : null}
          {signedIn && !accessLoading && !accessError && trucks.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)]">No food truck is attached to this account. Check the account used for the booking.</p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {!signedIn && !authLoading ? <Button asChild><Link href={parkingLoginHref(search)}>Sign in</Link></Button> : null}
            {accessError ? <Button type="button" variant="outline" disabled={accessLoading}
              onClick={() => setAccessAttempt((value) => value + 1)}>Retry truck access</Button> : null}
            {signedIn && intentId && truckId ? (
              <Button type="button" disabled={checking || accessLoading} onClick={() => {
                if (checkingRef.current) return;
                checkingRef.current = true;
                setChecking(true);
                setAttempt((value) => value + 1);
              }}>{checking ? "Checking booking status…" : "Check booking status"}</Button>
            ) : null}
            <Button type="button" variant="outline" disabled={!signedIn || authLoading || accessLoading || checking || !truckId}
              onClick={() => navigate(scheduleHref)}>View My Schedule</Button>
          </div>
          <p className="text-xs leading-relaxed text-[color:var(--text-muted)]">
            A failed status check does not mean payment failed. This page only reads booking status; it cannot charge or cancel a booking.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
