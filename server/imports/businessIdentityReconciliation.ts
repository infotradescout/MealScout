export type BusinessIdentity = {
  name?: unknown;
  city?: unknown;
  state?: unknown;
  phone?: unknown;
  email?: unknown;
  website?: unknown;
  instagram?: unknown;
  facebook?: unknown;
};

export type IdentityDecision = {
  disposition: "canonical_match" | "review_required" | "new_identity";
  reasons: string[];
};

const text = (value: unknown) => String(value ?? "").trim().toLowerCase();
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const nameKey = (value: unknown) => text(value).replace(/[^a-z0-9]/g, "");
const urlKey = (value: unknown) => {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  }
};

const same = (left: unknown, right: unknown) =>
  Boolean(text(left) && text(right) && text(left) === text(right));

export const reconcileBusinessIdentity = (
  incoming: BusinessIdentity,
  candidate?: BusinessIdentity | null,
): IdentityDecision => {
  if (!candidate) return { disposition: "new_identity", reasons: ["no_candidate"] };

  const incomingName = nameKey(incoming.name);
  const candidateName = nameKey(candidate.name);
  const nameMatches = Boolean(incomingName && candidateName && incomingName === candidateName);
  const nameConflicts = Boolean(incomingName && candidateName && incomingName !== candidateName);

  const locationMatches =
    same(incoming.city, candidate.city) &&
    (!text(incoming.state) || !text(candidate.state) || same(incoming.state, candidate.state));
  const phoneMatches = Boolean(
    digits(incoming.phone) &&
      digits(candidate.phone) &&
      digits(incoming.phone) === digits(candidate.phone),
  );
  const emailMatches = same(incoming.email, candidate.email);
  const websiteMatches = Boolean(
    urlKey(incoming.website) &&
      urlKey(candidate.website) &&
      urlKey(incoming.website) === urlKey(candidate.website),
  );
  const instagramMatches = Boolean(
    urlKey(incoming.instagram) &&
      urlKey(candidate.instagram) &&
      urlKey(incoming.instagram) === urlKey(candidate.instagram),
  );
  const facebookMatches = Boolean(
    urlKey(incoming.facebook) &&
      urlKey(candidate.facebook) &&
      urlKey(incoming.facebook) === urlKey(candidate.facebook),
  );
  const durableMatches = [
    phoneMatches && "phone_exact",
    emailMatches && "email_exact",
    websiteMatches && "website_exact",
    instagramMatches && "instagram_exact",
    facebookMatches && "facebook_exact",
  ].filter(Boolean) as string[];

  if (nameConflicts && durableMatches.length) {
    return {
      disposition: "review_required",
      reasons: ["business_name_conflicts_with_external_identity", ...durableMatches],
    };
  }
  if (nameMatches && (locationMatches || durableMatches.length)) {
    return {
      disposition: "canonical_match",
      reasons: [
        "business_name_exact",
        ...(locationMatches ? ["location_exact"] : []),
        ...durableMatches,
      ],
    };
  }
  if (durableMatches.length >= 2) {
    return { disposition: "canonical_match", reasons: durableMatches };
  }
  if (nameMatches || durableMatches.length) {
    return {
      disposition: "review_required",
      reasons: [
        ...(nameMatches ? ["name_only_is_not_identity_proof"] : []),
        ...durableMatches,
      ],
    };
  }
  return { disposition: "new_identity", reasons: ["no_identity_agreement"] };
};

