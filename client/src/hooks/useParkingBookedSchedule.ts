import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { parseISO } from "date-fns";

type Entry = { type: string; status: string; event?: { requiresPayment?: boolean | null } };
type Snapshot<T> = { scope: string; entries: T[]; loading: boolean; error: string | null; updatedAt: number | null };

/** One owner for initial load and refresh. Account/truck changes discard visible
 * old data immediately; failed refreshes retain explicitly marked last-known data.
 */
export function useParkingBookedSchedule<T extends Entry>(accountId: string | undefined, truckId: string | null) {
  const scope = accountId && truckId ? JSON.stringify([accountId, truckId]) : "";
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({ scope: "", entries: [], loading: false, error: null, updatedAt: null });
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!scope || activeScope.current !== scope) return false;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const request = ++sequence.current;
    const current = () => request === sequence.current && activeScope.current === scope;
    setSnapshot(previous => ({ scope, entries: previous.scope === scope ? previous.entries : [],
      loading: true, error: null, updatedAt: previous.scope === scope ? previous.updatedAt : null }));
    const timer = window.setTimeout(() => abort.abort(), 15_000);
    let denied = false;
    try {
      const response = await fetch(apiUrl(`/api/bookings/truck/${encodeURIComponent(truckId!)}/schedule`), {
        credentials: "include", signal: abort.signal,
      });
      denied = response.status === 401 || response.status === 403;
      if (!response.ok) throw new Error(denied ? "Booking access is unavailable. Sign in with the account that manages this truck." : "Booked stops could not be loaded. Retry to check your reservations.");
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as {schedule?:unknown}).schedule)) {
        throw new Error("The schedule response was incomplete. Retry before relying on these reservations.");
      }
      const rows = (payload as {schedule: unknown[]}).schedule;
      if (rows.some(row => !row || typeof row !== "object" || typeof (row as Entry).status !== "string" || typeof (row as Entry).type !== "string")) {
        throw new Error("The schedule response was incomplete. Retry before relying on these reservations.");
      }
      const entries = (rows as T[]).filter(row => row.type === "booking" && row.status === "confirmed" && row.event?.requiresPayment === true);
      if (entries.some(row => {
        const event = row.event as { id?: unknown; date?: unknown; startTime?: unknown; endTime?: unknown };
        return typeof event.id !== "string" || !event.id || typeof event.date !== "string" ||
          !Number.isFinite(parseISO(event.date).getTime()) ||
          typeof event.startTime !== "string" || typeof event.endTime !== "string";
      })) throw new Error("A booked stop has incomplete date or time details. Retry to verify the schedule.");
      if (!current()) return false;
      setSnapshot({ scope, entries, loading: false, error: null, updatedAt: Date.now() });
      return true;
    } catch (error) {
      if (current()) setSnapshot(previous => ({ scope,
        entries: !denied && previous.scope === scope ? previous.entries : [], loading: false,
        updatedAt: !denied && previous.scope === scope ? previous.updatedAt : null,
        error: abort.signal.aborted ? "The schedule check timed out. Retry to verify your booked stops." : error instanceof Error ? error.message : "Schedule unavailable. Retry to check your reservations.",
      }));
      return false;
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) controller.current = null;
    }
  }, [scope, truckId]);
  useEffect(() => {
    activeScope.current = scope;
    if (scope) void refresh();
    return () => { activeScope.current = ""; sequence.current++; controller.current?.abort(); };
  }, [scope, refresh]);
  const visible: Snapshot<T> = snapshot.scope === scope ? snapshot : {
    scope, entries: [], loading: Boolean(scope), error: null, updatedAt: null,
  };
  return { ...visible, refresh };
}
