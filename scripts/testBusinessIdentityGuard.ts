type IdentityCandidate = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
};

const collisionKeywordSet = new Set([
  "florida",
  "kitchen",
  "island",
  "cuisine",
  "jamaican",
  "caribbean",
]);
const commonStopWords = new Set([
  "the",
  "and",
  "llc",
  "inc",
  "co",
  "company",
  "restaurant",
  "grill",
  "cafe",
  "food",
  "truck",
]);

function toIdentityTokens(name: string) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !commonStopWords.has(token));
}

function needsIdentityReview(current: IdentityCandidate, candidates: IdentityCandidate[]) {
  const tokens = toIdentityTokens(current.name);
  const hasRiskyToken = tokens.some((token) => collisionKeywordSet.has(token));
  if (!hasRiskyToken) return false;
  return candidates.some((candidate) => {
    if (candidate.id === current.id) return false;
    const candidateTokens = toIdentityTokens(candidate.name);
    const overlapCount = tokens.filter((token) => candidateTokens.includes(token)).length;
    if (overlapCount < 2) return false;
    const cityStateA = `${String(current.city || "").trim().toLowerCase()}|${String(
      current.state || "",
    )
      .trim()
      .toLowerCase()}`;
    const cityStateB = `${String(candidate.city || "").trim().toLowerCase()}|${String(
      candidate.state || "",
    )
      .trim()
      .toLowerCase()}`;
    const phoneA = String(current.phone || "").replace(/\D/g, "");
    const phoneB = String(candidate.phone || "").replace(/\D/g, "");
    const websiteA = String(current.websiteUrl || "").trim().toLowerCase();
    const websiteB = String(candidate.websiteUrl || "").trim().toLowerCase();
    return (
      cityStateA !== cityStateB ||
      (phoneA && phoneB && phoneA !== phoneB) ||
      (websiteA && websiteB && websiteA !== websiteB)
    );
  });
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const a: IdentityCandidate = {
  id: "A",
  name: "The Florida Kitchen Island Cuisine",
  city: "Pensacola",
  state: "FL",
  phone: "555-111-1111",
  websiteUrl: "https://a.example",
};
const b: IdentityCandidate = {
  id: "B",
  name: "Florida Kitchen",
  city: "Mobile",
  state: "AL",
  phone: "555-999-9999",
  websiteUrl: "https://b.example",
};
const c: IdentityCandidate = {
  id: "C",
  name: "The Steakhouse",
  city: "Hammond",
  state: "LA",
};

assert(
  needsIdentityReview(a, [b, c]) === true,
  "Expected similar Florida Kitchen records to require identity review",
);
assert(
  needsIdentityReview(c, [a, b]) === false,
  "Expected unrelated records to avoid identity review",
);
assert(a.id !== b.id, "Similar businesses must remain separate records by ID");

console.log("business identity guard contract OK");
