const US_STATE_CODES = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga',
  'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md',
  'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj',
  'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc',
  'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy',
  'dc',
]);

export type GoldenPlateAreaSelection =
  | { kind: 'single'; value: string }
  | { kind: 'city_state'; city: string; state: string };

export function parseGoldenPlateAreaSelection(
  area: unknown,
): GoldenPlateAreaSelection | null {
  const normalized = String(area || '').trim().toLowerCase();
  if (!normalized) return null;

  const commaParts = normalized
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (commaParts.length > 1) {
    return {
      kind: 'city_state',
      city: commaParts[0],
      state: commaParts[1],
    };
  }

  const legacyStateSuffix = normalized.match(/^(.*)-([a-z]{2})$/);
  if (legacyStateSuffix && US_STATE_CODES.has(legacyStateSuffix[2])) {
    const city = legacyStateSuffix[1].trim();
    return city
      ? { kind: 'city_state', city, state: legacyStateSuffix[2] }
      : { kind: 'single', value: legacyStateSuffix[2] };
  }

  return { kind: 'single', value: normalized };
}
