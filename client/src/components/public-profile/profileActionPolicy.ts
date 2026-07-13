import type { PublicCta } from "@shared/publicProfiles";

export type ActionProfileType = "restaurant" | "truck" | "bar" | "host" | "supplier";

const ACTION_ORDER: Record<ActionProfileType | "generic", readonly string[]> = {
  restaurant: [
    "order",
    "menu",
    "map",
    "phone",
    "booking",
    "catering",
    "external",
    "share",
    "social",
    "internal",
  ],
  bar: [
    "order",
    "menu",
    "map",
    "phone",
    "booking",
    "external",
    "share",
    "social",
    "internal",
  ],
  truck: [
    "map",
    "order",
    "menu",
    "phone",
    "booking",
    "catering",
    "external",
    "share",
    "social",
    "internal",
  ],
  host: [
    "booking",
    "map",
    "phone",
    "external",
    "share",
    "social",
    "internal",
  ],
  supplier: [
    "order",
    "external",
    "phone",
    "map",
    "share",
    "social",
    "internal",
  ],
  generic: [
    "map",
    "order",
    "menu",
    "phone",
    "booking",
    "catering",
    "external",
    "share",
    "social",
    "internal",
  ],
};

export function rankPublicCtas(
  ctas: PublicCta[],
  profileType?: string | null,
): PublicCta[] {
  const key =
    profileType && profileType in ACTION_ORDER
      ? (profileType as ActionProfileType)
      : "generic";
  const order = ACTION_ORDER[key];
  const priority = new Map(order.map((type, index) => [type, index]));

  return ctas
    .filter((cta) => cta.safe === true && Boolean(String(cta.href || "").trim()))
    .map((cta, index) => ({ cta, index }))
    .sort(
      (a, b) =>
        (priority.get(a.cta.type) ?? 99) -
          (priority.get(b.cta.type) ?? 99) ||
        a.index - b.index,
    )
    .map(({ cta }) => cta);
}

export function primaryPublicCta(
  ctas: PublicCta[],
  profileType?: string | null,
): PublicCta | null {
  return rankPublicCtas(ctas, profileType)[0] ?? null;
}
