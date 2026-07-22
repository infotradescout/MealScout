import { DateTime, Interval } from "luxon";

export type TimeIntent =
  | "now"
  | "breakfast"
  | "lunch"
  | "dinner"
  | "tonight"
  | "this-weekend";

export function resolveTimeIntent(params: {
  timeZone: string;
  intent: TimeIntent;
  now?: Date;
}): { startUtc: Date; endUtc: Date; label: string } {
  const now = params.now ? DateTime.fromJSDate(params.now) : DateTime.utc();
  const localNow = now.setZone(params.timeZone);
  const today = localNow.startOf("day");

  const toUtc = (dt: DateTime) => dt.toUTC().toJSDate();
  const endOfDay = today.plus({ days: 1 }).minus({ milliseconds: 1 });

  switch (params.intent) {
    case "now":
      return {
        startUtc: toUtc(localNow),
        endUtc: toUtc(localNow.plus({ minutes: 1 })),
        label: "Food trucks now",
      };
    case "breakfast":
      return {
        startUtc: toUtc(today.set({ hour: 6, minute: 0 })),
        endUtc: toUtc(today.set({ hour: 10, minute: 30 })),
        label: "Breakfast food trucks",
      };
    case "lunch":
      return {
        startUtc: toUtc(today.set({ hour: 11, minute: 0 })),
        endUtc: toUtc(today.set({ hour: 14, minute: 0 })),
        label: "Lunch food trucks",
      };
    case "dinner":
      return {
        startUtc: toUtc(today.set({ hour: 17, minute: 0 })),
        endUtc: toUtc(today.set({ hour: 21, minute: 0 })),
        label: "Dinner food trucks",
      };
    case "tonight":
      return {
        startUtc: toUtc(today.set({ hour: 17, minute: 0 })),
        endUtc: toUtc(endOfDay),
        label: "Food trucks tonight",
      };
    case "this-weekend": {
      // If today is Fri/Sat/Sun, use the current weekend; otherwise use the upcoming Fri–Sun.
      const dow = localNow.weekday; // 1=Mon ... 7=Sun
      const isWeekendWindow = dow === 5 || dow === 6 || dow === 7;
      const daysUntilFriday = isWeekendWindow ? 0 : (5 - dow + 7) % 7;
      const friday = today.plus({ days: daysUntilFriday });
      const sundayEnd = friday.plus({ days: 2 }).endOf("day");
      return {
        startUtc: toUtc(friday.startOf("day")),
        endUtc: toUtc(sundayEnd),
        label: "Food trucks this weekend",
      };
    }
    default:
      return {
        startUtc: toUtc(localNow),
        endUtc: toUtc(localNow),
        label: "Food trucks",
      };
  }
}

export function intervalOverlaps(params: {
  startUtc: Date;
  endUtc: Date;
  otherStartUtc: Date;
  otherEndUtc: Date;
}): boolean {
  const a = Interval.fromDateTimes(
    DateTime.fromJSDate(params.startUtc),
    DateTime.fromJSDate(params.endUtc),
  );
  const b = Interval.fromDateTimes(
    DateTime.fromJSDate(params.otherStartUtc),
    DateTime.fromJSDate(params.otherEndUtc),
  );
  return Boolean(a.overlaps(b));
}

export function buildSlotDateTimes(params: {
  timeZone: string;
  date: Date | string;
  startTime: string;
  endTime: string;
}): { startUtc: Date; endUtc: Date } | null {
  const matchStart = String(params.startTime || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  const matchEnd = String(params.endTime || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!matchStart || !matchEnd) return null;
  const sh = Number(matchStart[1]);
  const sm = Number(matchStart[2]);
  const eh = Number(matchEnd[1]);
  const em = Number(matchEnd[2]);
  if (
    ![sh, sm, eh, em].every((n) => Number.isInteger(n)) ||
    sh < 0 ||
    sh > 23 ||
    eh < 0 ||
    eh > 23 ||
    sm < 0 ||
    sm > 59 ||
    em < 0 ||
    em > 59 ||
    (sh === eh && sm === em)
  ) {
    return null;
  }

  const dateKey = (() => {
    const raw = params.date as any;
    if (raw instanceof Date) {
      const iso = raw.toISOString();
      const key = iso.split("T")[0];
      return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
    }
    const text = String(raw || "").trim();
    if (!text) return null;
    const key = text.includes("T") ? text.split("T")[0] : text;
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
  })();
  if (!dateKey) return null;

  // IMPORTANT: treat schedule date as a *local calendar day* for the target timezone.
  // Never derive the day by converting a JS Date from UTC -> local, or you'll get off-by-one around midnight.
  const base = DateTime.fromISO(dateKey, { zone: params.timeZone }).startOf("day");
  if (!base.isValid) return null;

  let start = base.set({ hour: sh, minute: sm });
  let end = base.set({ hour: eh, minute: em });
  if (!start.isValid || !end.isValid) return null;
  if (end < start) {
    end = end.plus({ days: 1 });
  }
  if (end <= start) return null;
  return { startUtc: start.toUTC().toJSDate(), endUtc: end.toUTC().toJSDate() };
}
