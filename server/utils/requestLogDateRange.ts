const REQUEST_LOG_DEFAULT_WINDOW_MS = 48 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type RequestLogDateField = "startDate" | "endDate";

type MissingDateResult = {
  ok: true;
  missing: true;
};

type PresentDateResult = {
  ok: true;
  missing: false;
  date: Date;
};

type InvalidDateResult = {
  ok: false;
  field: RequestLogDateField;
  error: string;
};

type ParsedDateResult =
  | MissingDateResult
  | PresentDateResult
  | InvalidDateResult;

export type RequestLogDateRangeResult =
  | {
      ok: true;
      startDate: Date;
      endDate: Date;
    }
  | InvalidDateResult;

function getSingleQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string");
    return typeof first === "string" ? first : undefined;
  }

  return typeof value === "string" ? value : undefined;
}

function buildDateOnlyValue(
  rawValue: string,
  field: RequestLogDateField,
): PresentDateResult | InvalidDateResult {
  const [yearText, monthText, dayText] = rawValue.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date =
    field === "startDate"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);

  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return {
      ok: false,
      field,
      error: `Invalid ${field}. Use YYYY-MM-DD or a valid ISO-8601 date value.`,
    };
  }

  return {
    ok: true,
    missing: false,
    date,
  };
}

function parseDateFilter(
  value: unknown,
  field: RequestLogDateField,
): ParsedDateResult {
  const normalized = getSingleQueryValue(value)?.trim();

  if (!normalized) {
    return {
      ok: true,
      missing: true,
    };
  }

  if (DATE_ONLY_PATTERN.test(normalized)) {
    return buildDateOnlyValue(normalized, field);
  }

  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    return {
      ok: false,
      field,
      error: `Invalid ${field}. Use YYYY-MM-DD or a valid ISO-8601 date value.`,
    };
  }

  return {
    ok: true,
    missing: false,
    date: parsed,
  };
}

export function resolveRequestLogDateRange(params: {
  startDate?: unknown;
  endDate?: unknown;
  now?: Date;
}): RequestLogDateRangeResult {
  const now =
    params.now && Number.isFinite(params.now.getTime())
      ? new Date(params.now.getTime())
      : new Date();
  const parsedStart = parseDateFilter(params.startDate, "startDate");
  if (!parsedStart.ok) {
    return parsedStart;
  }

  const parsedEnd = parseDateFilter(params.endDate, "endDate");
  if (!parsedEnd.ok) {
    return parsedEnd;
  }

  return {
    ok: true,
    startDate: parsedStart.missing
      ? new Date(now.getTime() - REQUEST_LOG_DEFAULT_WINDOW_MS)
      : parsedStart.date,
    endDate: parsedEnd.missing ? now : parsedEnd.date,
  };
}
