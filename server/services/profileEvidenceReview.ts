import { createHash } from "node:crypto";

import {
  PROFILE_EVIDENCE_REVIEW_LIMITS,
  PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
  getProfileEvidenceFieldDefinition,
  normalizeProfileEvidenceConfidence,
  normalizeProfileEvidenceReviewValue,
  normalizeProfileEvidenceSourceKind,
  resolveProfileEvidenceReviewField,
  type ProfileEvidenceDecisionAction,
  type ProfileEvidenceOwnerProposalDto,
  type ProfileEvidenceOwnerReviewDto,
  type ProfileEvidenceReviewDecision,
  type ProfileEvidenceReviewField,
  type ProfileEvidenceReviewLedger,
  type ProfileEvidenceReviewProposal,
} from "@shared/profileEvidenceReview";

type AnyRecord = Record<string, unknown>;

export type ProfileEvidenceCurrentValues = Partial<
  Record<ProfileEvidenceReviewField, unknown>
>;

export type ProfileEvidenceOwnerImageLookup = Readonly<
  Record<string, string>
>;

export type NormalizeProfileEvidenceLedgerOptions = {
  restaurantId: string;
  fallbackReceivedAt: string;
  defaultBatchId?: string;
  currentValues?: ProfileEvidenceCurrentValues;
};

export type AppendProfileEvidenceResult = {
  ledger: ProfileEvidenceReviewLedger;
  addedIds: string[];
  duplicateIds: string[];
  droppedIds: string[];
  rejectedCount: number;
};

export type ProfileEvidenceProposalRejection = {
  id: string;
  inputIndex: number;
  code: "invalid_proposal" | "unsupported_field" | "invalid_value";
};

export type NormalizeProfileEvidenceProposalBatchResult = {
  proposals: ProfileEvidenceReviewProposal[];
  acceptedIds: string[];
  duplicateIds: string[];
  rejected: ProfileEvidenceProposalRejection[];
  droppedCount: number;
  droppedIds: string[];
};

export type QueuedProfileEvidenceItemRejection = {
  id: string;
  inputIndex: number;
  code: "invalid_item" | "invalid_or_oversized_value";
};

export type QueuedProfileEvidenceItemBatch<T> = {
  items: T[];
  acceptedIds: string[];
  duplicateIds: string[];
  rejected: QueuedProfileEvidenceItemRejection[];
  droppedCount: number;
  droppedIds: string[];
};

export type QueuedProfileEvidenceMenuItem = {
  name: string;
  description?: string;
  price?: string;
  category?: string;
};

export function parseDirectApplyMenuPriceCents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const price = String(value).trim();
  if (!/^\$?\d{1,6}(?:\.\d{1,2})?$/.test(price)) return null;
  const numericPrice = Number(price.replace(/^\$/, ""));
  if (!Number.isFinite(numericPrice)) return null;
  return Math.round(numericPrice * 100);
}

export type QueuedProfileEvidenceScheduleItem = {
  date: string;
  locationName: string;
  startTime: string;
  endTime: string;
  address?: string;
  city?: string;
  state?: string;
  notes?: string;
};

export type MergeProfileEvidenceQueueContainerInput = {
  freshContainer: Record<string, unknown> | null | undefined;
  queuedEvidenceApply: Record<string, unknown>;
  galleryEntries?: readonly Record<string, unknown>[];
  reviewQueueItems?: readonly Record<string, unknown>[];
  uploadedEvidence?: readonly Record<string, unknown>[];
};

export type ProfileEvidenceQueueMergeItemResult = {
  acceptedIds: string[];
  duplicateIds: string[];
  droppedCount: number;
  droppedIds: string[];
};

export type MergeProfileEvidenceQueueContainerResult = {
  container: Record<string, unknown>;
  results: {
    sourceNotes: ProfileEvidenceQueueMergeItemResult;
    missingInfo: ProfileEvidenceQueueMergeItemResult;
    menuItems: ProfileEvidenceQueueMergeItemResult;
    scheduleItems: ProfileEvidenceQueueMergeItemResult;
    reviewQueue: ProfileEvidenceQueueMergeItemResult;
    uploadedEvidence: ProfileEvidenceQueueMergeItemResult;
    galleryEntries: ProfileEvidenceQueueMergeItemResult;
  };
};

export type ProfileEvidenceDecisionRequestAction =
  | "confirm"
  | "correct"
  | "decline";

export type PlanProfileEvidenceDecisionInput = {
  ledger: ProfileEvidenceReviewLedger;
  proposalId: string;
  action: ProfileEvidenceDecisionRequestAction;
  correctedValue?: unknown;
  currentValue: unknown;
  expectedCurrentValueFingerprint: string;
  actorUserId: string;
  clientRequestId: string;
  decidedAt: string;
};

export type ProfileEvidenceFieldMutation = {
  field: ProfileEvidenceReviewField;
  destination: ReturnType<typeof getProfileEvidenceFieldDefinition>["destination"];
  previousValue: string | null;
  nextValue: string;
};

export function isDirectProfileEvidenceApplyDisabledMode(
  requestedMode: unknown,
): boolean {
  return String(requestedMode || "")
    .trim()
    .toLowerCase() === "apply";
}

export type ProfileEvidenceDecisionPlan =
  | {
      status: "planned";
      ledger: ProfileEvidenceReviewLedger;
      decision: ProfileEvidenceReviewDecision;
      mutation: ProfileEvidenceFieldMutation | null;
    }
  | {
      status: "idempotent";
      ledger: ProfileEvidenceReviewLedger;
      decision: ProfileEvidenceReviewDecision;
      mutation: null;
    }
  | {
      status: "stale";
      ledger: ProfileEvidenceReviewLedger;
      currentValueFingerprint: string;
    }
  | {
      status: "conflict";
      ledger: ProfileEvidenceReviewLedger;
      decision: ProfileEvidenceReviewDecision;
    }
  | {
      status: "not_found";
      ledger: ProfileEvidenceReviewLedger;
    }
  | {
      status: "invalid";
      ledger: ProfileEvidenceReviewLedger;
      code: string;
      message: string;
    };

const asRecord = (value: unknown): AnyRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};

const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalizeJson(nested)]),
    );
  }
  return value;
};

export function createProfileEvidenceIntakeRequestFingerprint(input: {
  requestBody: unknown;
  files: readonly Record<string, unknown>[];
}): string {
  return sha256([
    "mealscout-profile-evidence-intake-request",
    PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
    canonicalizeJson(input.requestBody),
    canonicalizeJson(input.files),
  ]);
}

const isSha256 = (value: unknown) => /^[a-f0-9]{64}$/.test(String(value || ""));

const normalizeIso = (value: unknown, fallback: string) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
};

const normalizeRequiredId = (
  value: unknown,
  maxLength: number,
  label: string,
) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
};

const sanitizePlainText = (
  value: unknown,
  maxLength: number,
  options: { multiline?: boolean } = {},
): string | null => {
  if (value === null || value === undefined) return null;
  if (!["string", "number", "boolean"].includes(typeof value)) return null;
  const raw = String(value).replace(/\r\n?/g, "\n");
  const controlPattern = options.multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (controlPattern.test(raw)) return null;
  const normalized = options.multiline
    ? raw.trim()
    : raw.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

const sanitizeHttpUrl = (value: unknown): string | null => {
  const text = sanitizePlainText(
    value,
    PROFILE_EVIDENCE_REVIEW_LIMITS.sourceUrl,
  );
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    const normalized = parsed.toString();
    return normalized.length <= PROFILE_EVIDENCE_REVIEW_LIMITS.sourceUrl
      ? normalized
      : null;
  } catch {
    return null;
  }
};

const sanitizeImageEvidenceIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const candidate of value) {
    const normalized = sanitizePlainText(
      candidate,
      PROFILE_EVIDENCE_REVIEW_LIMITS.imageEvidenceId,
    );
    if (!normalized || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) continue;
    unique.add(normalized);
    if (unique.size >= PROFILE_EVIDENCE_REVIEW_LIMITS.imageEvidenceIds) break;
  }
  return Array.from(unique);
};

const normalizeCurrentValueForDisplay = (
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): string | null => {
  if (value === null || value === undefined) return null;
  if (!["string", "number", "boolean"].includes(typeof value)) return null;
  const normalized = String(value).replace(/\r\n?/g, "\n").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
};

const createDecisionRequestFingerprint = (input: {
  proposalId: string;
  action: ProfileEvidenceDecisionRequestAction;
  appliedValue: string | null;
  expectedCurrentValueFingerprint: string;
}) =>
  sha256([
    "mealscout-profile-evidence-decision-request",
    PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
    input.proposalId,
    input.action,
    input.appliedValue,
    input.expectedCurrentValueFingerprint,
  ]);

const requestActionForStoredDecision = (
  action: ProfileEvidenceDecisionAction,
): ProfileEvidenceDecisionRequestAction =>
  action === "confirmed"
    ? "confirm"
    : action === "corrected"
      ? "correct"
      : "decline";

export function createProfileEvidenceProposalId(input: {
  restaurantId: string;
  field: ProfileEvidenceReviewField;
  proposedValue: unknown;
  sourceIdentity: unknown;
}): string {
  const restaurantId = normalizeRequiredId(input.restaurantId, 200, "restaurantId");
  const proposedValue = normalizeProfileEvidenceReviewValue(
    input.field,
    input.proposedValue,
  );
  const sourceIdentity =
    sanitizePlainText(
      input.sourceIdentity,
      PROFILE_EVIDENCE_REVIEW_LIMITS.sourceIdentity,
    ) || "unspecified";
  return sha256([
    "mealscout-profile-evidence-proposal",
    PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
    restaurantId,
    input.field,
    proposedValue,
    sourceIdentity,
  ]);
}

export function createProfileEvidenceValueFingerprint(
  field: ProfileEvidenceReviewField,
  value: unknown,
): string {
  return sha256([
    "mealscout-profile-evidence-current-value",
    PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
    field,
    normalizeCurrentValueForDisplay(value),
  ]);
}

function normalizeProposal(
  rawValue: unknown,
  options: NormalizeProfileEvidenceLedgerOptions & {
    trustStoredCurrentValueAtIntake?: boolean;
  },
): { proposal: ProfileEvidenceReviewProposal; rawId: string | null } | null {
  const raw = asRecord(rawValue);
  const field = resolveProfileEvidenceReviewField(raw.field);
  if (!field) return null;

  let proposedValue: string;
  try {
    proposedValue = normalizeProfileEvidenceReviewValue(
      field,
      raw.proposedValue,
    );
  } catch {
    return null;
  }

  const sourceKind = normalizeProfileEvidenceSourceKind(
    raw.sourceKind || raw.source,
  );
  const sourceUrl = sanitizeHttpUrl(raw.sourceUrl || raw.url);
  const imageEvidenceIds = sanitizeImageEvidenceIds([
    ...(Array.isArray(raw.imageEvidenceIds) ? raw.imageEvidenceIds : []),
    raw.imageRef,
  ]);
  const sourceLabel = sanitizePlainText(
    raw.sourceLabel || raw.source,
    PROFILE_EVIDENCE_REVIEW_LIMITS.sourceLabel,
  );
  const evidenceExcerpt = sanitizePlainText(
    raw.evidenceExcerpt || raw.evidenceText,
    PROFILE_EVIDENCE_REVIEW_LIMITS.evidenceExcerpt,
    { multiline: true },
  );
  const imageEvidenceIdentity = imageEvidenceIds.length
    ? `images:${sha256([...imageEvidenceIds].sort())}`
    : null;
  const sourceIdentity =
    sourceKind === "screenshot"
      ? `screenshot:${sha256([
          sourceUrl ||
            [sourceLabel, evidenceExcerpt].filter(Boolean).join("|") ||
            "unspecified",
          imageEvidenceIdentity || "images:none",
        ])}`
      : sanitizePlainText(
          raw.sourceIdentity ||
            raw.imageRef ||
            sourceUrl ||
            imageEvidenceIdentity ||
            [sourceLabel, evidenceExcerpt].filter(Boolean).join("|"),
          PROFILE_EVIDENCE_REVIEW_LIMITS.sourceIdentity,
        ) || "unspecified";
  const batchId =
    sanitizePlainText(
      raw.batchId || options.defaultBatchId,
      PROFILE_EVIDENCE_REVIEW_LIMITS.batchId,
    ) || `legacy-${sha256([options.restaurantId, sourceIdentity]).slice(0, 20)}`;
  const receivedAt = normalizeIso(raw.receivedAt, options.fallbackReceivedAt);
  const id = createProfileEvidenceProposalId({
    restaurantId: options.restaurantId,
    field,
    proposedValue,
    sourceIdentity,
  });
  const currentValueAtIntake = normalizeCurrentValueForDisplay(
    options.trustStoredCurrentValueAtIntake
      ? raw.currentValueAtIntake
      : options.currentValues?.[field],
    getProfileEvidenceFieldDefinition(field).maxLength,
  );

  return {
    rawId: isSha256(raw.id) ? String(raw.id) : null,
    proposal: {
      id,
      batchId,
      field,
      proposedValue,
      currentValueAtIntake,
      confidence: normalizeProfileEvidenceConfidence(raw.confidence),
      sourceKind,
      sourceIdentity,
      sourceLabel,
      sourceUrl,
      evidenceExcerpt,
      imageEvidenceIds,
      receivedAt,
    },
  };
}

export function normalizeLegacyProfileEvidenceProposals(
  rawValue: unknown,
  options: NormalizeProfileEvidenceLedgerOptions,
): ProfileEvidenceReviewProposal[] {
  const values = Array.isArray(rawValue)
    ? rawValue.slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch)
    : [];
  const proposals = new Map<string, ProfileEvidenceReviewProposal>();
  for (const value of values) {
    const normalized = normalizeProposal(value, options)?.proposal;
    if (normalized && !proposals.has(normalized.id)) {
      proposals.set(normalized.id, normalized);
    }
  }
  return Array.from(proposals.values());
}

export function normalizeProfileEvidenceProposalBatch(
  rawValue: unknown,
  options: NormalizeProfileEvidenceLedgerOptions,
): NormalizeProfileEvidenceProposalBatchResult {
  const values = Array.isArray(rawValue) ? rawValue : [];
  const proposals = new Map<string, ProfileEvidenceReviewProposal>();
  const acceptedIds: string[] = [];
  const duplicateIds: string[] = [];
  const rejected: ProfileEvidenceProposalRejection[] = [];
  const droppedCount = Math.max(
    0,
    values.length - PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch,
  );
  const droppedIds = Array.from(
    {
      length: Math.min(
        droppedCount,
        PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch,
      ),
    },
    (_, offset) =>
      `input:${PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch + offset}`,
  );

  const processCount = Math.min(
    values.length,
    PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch,
  );
  for (let inputIndex = 0; inputIndex < processCount; inputIndex += 1) {
    const candidate = values[inputIndex];
    const fallbackId = `input:${inputIndex}`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      rejected.push({ id: fallbackId, inputIndex, code: "invalid_proposal" });
      continue;
    }
    const raw = candidate as AnyRecord;
    const field = resolveProfileEvidenceReviewField(raw.field);
    if (!field) {
      rejected.push({ id: fallbackId, inputIndex, code: "unsupported_field" });
      continue;
    }
    const normalized = normalizeProposal(candidate, options)?.proposal;
    if (!normalized) {
      rejected.push({ id: fallbackId, inputIndex, code: "invalid_value" });
      continue;
    }
    if (proposals.has(normalized.id)) {
      duplicateIds.push(normalized.id);
      continue;
    }
    proposals.set(normalized.id, normalized);
    acceptedIds.push(normalized.id);
  }

  return {
    proposals: Array.from(proposals.values()),
    acceptedIds,
    duplicateIds,
    rejected,
    droppedCount,
    droppedIds,
  };
}

const normalizeStrictQueuedText = (
  value: unknown,
  maxLength: number,
  required: boolean,
): { valid: boolean; value?: string } => {
  if (value === null || value === undefined || value === "") {
    return required ? { valid: false } : { valid: true };
  }
  if (!["string", "number", "boolean"].includes(typeof value)) {
    return { valid: false };
  }
  const raw = String(value).replace(/\r\n?/g, "\n");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
    return { valid: false };
  }
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength) {
    return required ? { valid: false } : normalized ? { valid: false } : { valid: true };
  }
  return { valid: true, value: normalized };
};

export function normalizeQueuedProfileEvidenceTextItems(
  rawValue: unknown,
  namespace: "source-note" | "missing-info",
): QueuedProfileEvidenceItemBatch<string> {
  const values = Array.isArray(rawValue) ? rawValue : [];
  const droppedCount = Math.max(0, values.length - 100);
  const result: QueuedProfileEvidenceItemBatch<string> = {
    items: [],
    acceptedIds: [],
    duplicateIds: [],
    rejected: [],
    droppedCount,
    droppedIds: Array.from(
      { length: Math.min(droppedCount, PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch) },
      (_, offset) => `${namespace}:input:${100 + offset}`,
    ),
  };
  const seen = new Set<string>();
  const processCount = Math.min(values.length, 100);
  for (let inputIndex = 0; inputIndex < processCount; inputIndex += 1) {
    const normalized = normalizeStrictQueuedText(values[inputIndex], 1000, true);
    if (!normalized.valid || !normalized.value) {
      result.rejected.push({
        id: `${namespace}:input:${inputIndex}`,
        inputIndex,
        code: "invalid_or_oversized_value",
      });
      continue;
    }
    const id = sha256([`profile-evidence-${namespace}`, normalized.value]);
    if (seen.has(id)) {
      result.duplicateIds.push(id);
      continue;
    }
    seen.add(id);
    result.items.push(normalized.value);
    result.acceptedIds.push(id);
  }
  return result;
}

const isValidIsoDateOnly = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const normalizeTime = (value: unknown): string | null => {
  const normalized = normalizeStrictQueuedText(value, 8, true);
  if (!normalized.valid || !normalized.value) return null;
  const match = normalized.value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : null;
};

const inputItemId = (kind: "menu" | "schedule", index: number) =>
  `${kind}:input:${index}`;

export function normalizeQueuedProfileEvidenceMenuItems(
  rawValue: unknown,
): QueuedProfileEvidenceItemBatch<QueuedProfileEvidenceMenuItem> {
  const values = Array.isArray(rawValue) ? rawValue : [];
  const result: QueuedProfileEvidenceItemBatch<QueuedProfileEvidenceMenuItem> = {
    items: [],
    acceptedIds: [],
    duplicateIds: [],
    rejected: [],
    droppedCount: Math.max(
      0,
      values.length - PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuItems,
    ),
    droppedIds: [],
  };
  result.droppedIds = Array.from(
    {
      length: Math.min(
        result.droppedCount,
        PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch,
      ),
    },
    (_, offset) =>
      inputItemId(
        "menu",
        PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuItems + offset,
      ),
  );
  const seen = new Set<string>();
  const processCount = Math.min(
    values.length,
    PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuItems,
  );
  for (let inputIndex = 0; inputIndex < processCount; inputIndex += 1) {
    const raw = asRecord(values[inputIndex]);
    if (Object.keys(raw).length === 0) {
      result.rejected.push({
        id: inputItemId("menu", inputIndex),
        inputIndex,
        code: "invalid_item",
      });
      continue;
    }
    const name = normalizeStrictQueuedText(
      raw.name ?? raw.item_name,
      PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuName,
      true,
    );
    const description = normalizeStrictQueuedText(
      raw.description,
      PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuDescription,
      false,
    );
    const price = normalizeStrictQueuedText(
      raw.price,
      PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuPrice,
      false,
    );
    const category = normalizeStrictQueuedText(
      raw.category ?? raw.category_name,
      PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuCategory,
      false,
    );
    if (![name, description, price, category].every((part) => part.valid) || !name.value) {
      result.rejected.push({
        id: inputItemId("menu", inputIndex),
        inputIndex,
        code: "invalid_or_oversized_value",
      });
      continue;
    }
    const item: QueuedProfileEvidenceMenuItem = {
      name: name.value,
      ...(description.value ? { description: description.value } : {}),
      ...(price.value ? { price: price.value } : {}),
      ...(category.value ? { category: category.value } : {}),
    };
    const id = sha256(["queued-profile-evidence-menu", item]);
    if (seen.has(id)) {
      result.duplicateIds.push(id);
      continue;
    }
    seen.add(id);
    result.items.push(item);
    result.acceptedIds.push(id);
  }
  return result;
}

export function normalizeQueuedProfileEvidenceScheduleItems(
  rawValue: unknown,
): QueuedProfileEvidenceItemBatch<QueuedProfileEvidenceScheduleItem> {
  const values = Array.isArray(rawValue) ? rawValue : [];
  const result: QueuedProfileEvidenceItemBatch<QueuedProfileEvidenceScheduleItem> = {
    items: [],
    acceptedIds: [],
    duplicateIds: [],
    rejected: [],
    droppedCount: Math.max(
      0,
      values.length - PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleItems,
    ),
    droppedIds: [],
  };
  result.droppedIds = Array.from(
    {
      length: Math.min(
        result.droppedCount,
        PROFILE_EVIDENCE_REVIEW_LIMITS.proposalsPerBatch,
      ),
    },
    (_, offset) =>
      inputItemId(
        "schedule",
        PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleItems + offset,
      ),
  );
  const seen = new Set<string>();
  const processCount = Math.min(
    values.length,
    PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleItems,
  );
  for (let inputIndex = 0; inputIndex < processCount; inputIndex += 1) {
    const raw = asRecord(values[inputIndex]);
    if (Object.keys(raw).length === 0) {
      result.rejected.push({
        id: inputItemId("schedule", inputIndex),
        inputIndex,
        code: "invalid_item",
      });
      continue;
    }
    const date = normalizeStrictQueuedText(raw.date, 10, true);
    const locationName = normalizeStrictQueuedText(
      raw.locationName ?? raw.location_name,
      PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleLocation,
      true,
    );
    const startTime = normalizeTime(raw.startTime ?? raw.start_time);
    const endTime = normalizeTime(raw.endTime ?? raw.end_time);
    const address = normalizeStrictQueuedText(
      raw.address,
      PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleAddress,
      false,
    );
    const city = normalizeStrictQueuedText(
      raw.city,
      PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleCity,
      false,
    );
    const state = normalizeStrictQueuedText(
      raw.state,
      PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleState,
      false,
    );
    const notes = normalizeStrictQueuedText(
      raw.notes,
      PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleNotes,
      false,
    );
    const optionalParts = [address, city, state, notes];
    if (
      !date.valid ||
      !date.value ||
      !isValidIsoDateOnly(date.value) ||
      !locationName.valid ||
      !locationName.value ||
      !startTime ||
      !endTime ||
      !optionalParts.every((part) => part.valid)
    ) {
      result.rejected.push({
        id: inputItemId("schedule", inputIndex),
        inputIndex,
        code: "invalid_or_oversized_value",
      });
      continue;
    }
    const item: QueuedProfileEvidenceScheduleItem = {
      date: date.value,
      locationName: locationName.value,
      startTime,
      endTime,
      ...(address.value ? { address: address.value } : {}),
      ...(city.value ? { city: city.value } : {}),
      ...(state.value ? { state: state.value } : {}),
      ...(notes.value ? { notes: notes.value } : {}),
    };
    const id = sha256(["queued-profile-evidence-schedule", item]);
    if (seen.has(id)) {
      result.duplicateIds.push(id);
      continue;
    }
    seen.add(id);
    result.items.push(item);
    result.acceptedIds.push(id);
  }
  return result;
}

const normalizeDecision = (
  rawValue: unknown,
  proposal: ProfileEvidenceReviewProposal,
  fallbackReceivedAt: string,
): ProfileEvidenceReviewDecision | null => {
  const raw = asRecord(rawValue);
  if (!['confirmed', 'corrected', 'declined'].includes(String(raw.action || ""))) {
    return null;
  }
  const action = String(raw.action) as ProfileEvidenceDecisionAction;
  let appliedValue: string | null = null;
  if (action !== "declined") {
    try {
      appliedValue = normalizeProfileEvidenceReviewValue(
        proposal.field,
        raw.appliedValue,
      );
    } catch {
      return null;
    }
  }
  const previousValue = normalizeCurrentValueForDisplay(
    raw.previousValue,
    getProfileEvidenceFieldDefinition(proposal.field).maxLength,
  );
  const previousValueFingerprint = isSha256(raw.previousValueFingerprint)
    ? String(raw.previousValueFingerprint)
    : createProfileEvidenceValueFingerprint(proposal.field, previousValue);
  const decidedByUserId = sanitizePlainText(
    raw.decidedByUserId,
    PROFILE_EVIDENCE_REVIEW_LIMITS.actorId,
  );
  const clientRequestId = sanitizePlainText(
    raw.clientRequestId,
    PROFILE_EVIDENCE_REVIEW_LIMITS.clientRequestId,
  );
  if (!decidedByUserId || !clientRequestId) return null;
  const expectedRequestFingerprint = createDecisionRequestFingerprint({
    proposalId: proposal.id,
    action: requestActionForStoredDecision(action),
    appliedValue,
    expectedCurrentValueFingerprint: previousValueFingerprint,
  });
  const requestFingerprint =
    isSha256(raw.requestFingerprint) &&
    String(raw.requestFingerprint) === expectedRequestFingerprint
      ? String(raw.requestFingerprint)
      : expectedRequestFingerprint;
  return {
    action,
    appliedValue,
    previousValue,
    previousValueFingerprint,
    decidedAt: normalizeIso(raw.decidedAt, fallbackReceivedAt),
    decidedByUserId,
    clientRequestId,
    requestFingerprint,
  };
};

export function normalizeProfileEvidenceReviewLedger(
  rawValue: unknown,
  options: NormalizeProfileEvidenceLedgerOptions,
): ProfileEvidenceReviewLedger {
  normalizeRequiredId(options.restaurantId, 200, "restaurantId");
  const fallbackReceivedAt = normalizeIso(
    options.fallbackReceivedAt,
    "1970-01-01T00:00:00.000Z",
  );
  const root = asRecord(rawValue);
  const evidenceApply = asRecord(root.evidenceApply || root);
  const canonical = asRecord(evidenceApply.ownerReview || evidenceApply);
  const proposals = new Map<string, ProfileEvidenceReviewProposal>();
  const rawIdToCanonicalId = new Map<string, string>();

  const canonicalCandidates = Array.isArray(canonical.proposals)
    ? canonical.proposals.slice(0, PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals)
    : [];
  for (const candidate of canonicalCandidates) {
    const normalized = normalizeProposal(candidate, {
      ...options,
      fallbackReceivedAt,
      trustStoredCurrentValueAtIntake: true,
    });
    if (!normalized || proposals.has(normalized.proposal.id)) continue;
    proposals.set(normalized.proposal.id, normalized.proposal);
    if (normalized.rawId) {
      rawIdToCanonicalId.set(normalized.rawId, normalized.proposal.id);
    }
  }

  const legacyProposals = normalizeLegacyProfileEvidenceProposals(
    evidenceApply.evidenceFieldProposals,
    { ...options, fallbackReceivedAt },
  );
  for (const proposal of legacyProposals) {
    if (proposals.size >= PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals) break;
    if (!proposals.has(proposal.id)) proposals.set(proposal.id, proposal);
  }

  const decisions: Record<string, ProfileEvidenceReviewDecision> = {};
  const rawDecisions = asRecord(canonical.decisions);
  for (const [rawProposalId, rawDecision] of Object.entries(rawDecisions)) {
    if (Object.keys(decisions).length >= PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerDecisions) {
      break;
    }
    const proposalId = rawIdToCanonicalId.get(rawProposalId) || rawProposalId;
    const proposal = proposals.get(proposalId);
    if (!proposal) continue;
    const decision = normalizeDecision(
      rawDecision,
      proposal,
      fallbackReceivedAt,
    );
    if (decision) decisions[proposal.id] = decision;
  }

  return {
    schemaVersion: PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
    proposals: Array.from(proposals.values()),
    decisions,
  };
}

export function appendProfileEvidenceReviewProposals(
  ledger: ProfileEvidenceReviewLedger,
  incoming: readonly ProfileEvidenceReviewProposal[],
  options: NormalizeProfileEvidenceLedgerOptions,
): AppendProfileEvidenceResult {
  const normalizedLedger = normalizeProfileEvidenceReviewLedger(ledger, options);
  const proposals = new Map(
    normalizedLedger.proposals.map((proposal) => [proposal.id, proposal]),
  );
  const addedIds: string[] = [];
  const duplicateIds: string[] = [];
  const droppedIds: string[] = [];
  let rejectedCount = 0;

  for (const candidate of incoming) {
    const normalized = normalizeProposal(candidate, options)?.proposal;
    if (!normalized) {
      rejectedCount += 1;
      continue;
    }
    if (proposals.has(normalized.id)) {
      duplicateIds.push(normalized.id);
      continue;
    }
    if (proposals.size >= PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals) {
      droppedIds.push(normalized.id);
      continue;
    }
    proposals.set(normalized.id, normalized);
    addedIds.push(normalized.id);
  }

  return {
    ledger: {
      schemaVersion: PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
      proposals: Array.from(proposals.values()),
      decisions: { ...normalizedLedger.decisions },
    },
    addedIds,
    duplicateIds,
    droppedIds,
    rejectedCount,
  };
}

type BoundedMergeResult<T> = ProfileEvidenceQueueMergeItemResult & {
  items: T[];
};

const mergeBoundedPreservingExisting = <T>(input: {
  existing: readonly T[];
  incoming: readonly T[];
  limit: number;
  keyFor: (item: T) => string;
}): BoundedMergeResult<T> => {
  const seen = new Set<string>();
  const items: T[] = [];
  for (const item of input.existing) {
    const key = input.keyFor(item);
    if (key) seen.add(key);
    items.push(item);
  }
  const acceptedIds: string[] = [];
  const duplicateIds: string[] = [];
  const droppedIds: string[] = [];
  for (const item of input.incoming) {
    const key = input.keyFor(item);
    if (!key || seen.has(key)) {
      if (key) duplicateIds.push(key);
      continue;
    }
    if (items.length >= input.limit) {
      droppedIds.push(key);
      continue;
    }
    seen.add(key);
    items.push(item);
    acceptedIds.push(key);
  }
  return {
    items,
    acceptedIds,
    duplicateIds,
    droppedCount: droppedIds.length,
    droppedIds,
  };
};

const recordKey = (namespace: string, item: Record<string, unknown>) =>
  String(
    item.id ||
      item.imageUploadId ||
      item.url ||
      sha256([namespace, item]),
  );

const mergeJsonRecords = (
  existing: unknown,
  incoming: readonly Record<string, unknown>[],
  limit: number,
  namespace: string,
) =>
  mergeBoundedPreservingExisting({
    existing: Array.isArray(existing)
      ? existing.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [],
    incoming,
    limit,
    keyFor: (item) => recordKey(namespace, item),
  });

const mergeBoundedStrings = (
  existing: unknown,
  incoming: unknown,
  limit: number,
  namespace: string,
) =>
  mergeBoundedPreservingExisting({
    existing: (Array.isArray(existing) ? existing : [])
      .map((value) => sanitizePlainText(value, 1000, { multiline: true }))
      .filter((value): value is string => Boolean(value)),
    incoming: (Array.isArray(incoming) ? incoming : [])
      .map((value) => sanitizePlainText(value, 1000, { multiline: true }))
      .filter((value): value is string => Boolean(value)),
    limit,
    keyFor: (value) => sha256([namespace, value]),
  });

const mergeGalleryPreservingPublicEntries = (
  existing: unknown,
  incoming: readonly Record<string, unknown>[],
): BoundedMergeResult<unknown> => {
  const items = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(
    items.map((item) =>
      typeof item === "string"
        ? `url:${item}`
        : item && typeof item === "object" && !Array.isArray(item)
          ? recordKey("profile-evidence-gallery", item as Record<string, unknown>)
          : sha256(["legacy-gallery-entry", item]),
    ),
  );
  const acceptedIds: string[] = [];
  const duplicateIds: string[] = [];
  const droppedIds: string[] = [];
  for (const item of incoming) {
    const key = recordKey("profile-evidence-gallery", item);
    const urlKey = typeof item.url === "string" ? `url:${item.url}` : "";
    if (seen.has(key) || (urlKey && seen.has(urlKey))) {
      duplicateIds.push(key);
      continue;
    }
    if (items.length >= PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals) {
      droppedIds.push(key);
      continue;
    }
    items.push(item);
    seen.add(key);
    if (urlKey) seen.add(urlKey);
    acceptedIds.push(key);
  }
  return {
    items,
    acceptedIds,
    duplicateIds,
    droppedCount: droppedIds.length,
    droppedIds,
  };
};

const mergeOwnerReviewRecords = (freshValue: unknown, queuedValue: unknown) => {
  const fresh = asRecord(freshValue);
  const queued = asRecord(queuedValue);
  const proposals = mergeJsonRecords(
    fresh.proposals,
    Array.isArray(queued.proposals)
      ? queued.proposals.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [],
    PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals,
    "owner-review-proposal",
  ).items;
  const freshDecisions = asRecord(fresh.decisions);
  const queuedDecisions = asRecord(queued.decisions);
  const proposalIds = new Set(proposals.map((proposal) => String(proposal.id || "")));
  const decisions: Record<string, unknown> = {};
  for (const [proposalId, decision] of Object.entries(freshDecisions)) {
    if (proposalIds.has(proposalId)) decisions[proposalId] = decision;
  }
  for (const [proposalId, decision] of Object.entries(queuedDecisions)) {
    if (!proposalIds.has(proposalId) || decisions[proposalId]) continue;
    if (
      Object.keys(decisions).length >=
      PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerDecisions
    ) {
      break;
    }
    decisions[proposalId] = decision;
  }
  return {
    schemaVersion: PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
    proposals,
    decisions,
  };
};

/**
 * Merge queue-only state into a freshly locked container. Callers must build
 * queuedEvidenceApply from that same fresh container, so owner decisions and
 * unrelated settings committed before the lock/re-read are retained.
 */
export function mergeProfileEvidenceQueueContainerWithReport(
  input: MergeProfileEvidenceQueueContainerInput,
): MergeProfileEvidenceQueueContainerResult {
  const freshContainer = asRecord(input.freshContainer);
  const freshEvidenceApply = asRecord(freshContainer.evidenceApply);
  const queuedEvidenceApply = asRecord(input.queuedEvidenceApply);
  const sourceNotes = mergeBoundedStrings(
    freshEvidenceApply.sourceNotes,
    queuedEvidenceApply.sourceNotes,
    100,
    "profile-evidence-source-note",
  );
  const missingInfo = mergeBoundedStrings(
    freshEvidenceApply.missingInfo,
    queuedEvidenceApply.missingInfo,
    100,
    "profile-evidence-missing-info",
  );
  const evidenceFieldProposals = mergeJsonRecords(
    freshEvidenceApply.evidenceFieldProposals,
    Array.isArray(queuedEvidenceApply.evidenceFieldProposals)
      ? queuedEvidenceApply.evidenceFieldProposals.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [],
    PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals,
    "legacy-evidence-proposal",
  ).items;
  const freshMenuItems = normalizeQueuedProfileEvidenceMenuItems(
    freshEvidenceApply.queuedMenuItems,
  ).items;
  const incomingMenuItems = normalizeQueuedProfileEvidenceMenuItems(
    queuedEvidenceApply.queuedMenuItems,
  ).items;
  const queuedMenuItems = mergeBoundedPreservingExisting({
    existing: freshMenuItems,
    incoming: incomingMenuItems,
    limit: PROFILE_EVIDENCE_REVIEW_LIMITS.queuedMenuItems,
    keyFor: (item) => sha256(["queued-profile-evidence-menu", item]),
  });
  const freshScheduleItems = normalizeQueuedProfileEvidenceScheduleItems(
    freshEvidenceApply.queuedScheduleItems,
  ).items;
  const incomingScheduleItems = normalizeQueuedProfileEvidenceScheduleItems(
    queuedEvidenceApply.queuedScheduleItems,
  ).items;
  const queuedScheduleItems = mergeBoundedPreservingExisting({
    existing: freshScheduleItems,
    incoming: incomingScheduleItems,
    limit: PROFILE_EVIDENCE_REVIEW_LIMITS.queuedScheduleItems,
    keyFor: (item) => sha256(["queued-profile-evidence-schedule", item]),
  });
  const ownerReview = mergeOwnerReviewRecords(
    freshEvidenceApply.ownerReview,
    queuedEvidenceApply.ownerReview,
  );
  const reviewQueue = mergeJsonRecords(
    freshEvidenceApply.reviewQueue,
    input.reviewQueueItems || [],
    PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals,
    "profile-evidence-review-queue",
  );
  const uploadedEvidence = mergeJsonRecords(
    freshEvidenceApply.uploadedEvidence,
    input.uploadedEvidence || [],
    PROFILE_EVIDENCE_REVIEW_LIMITS.ledgerProposals,
    "profile-evidence-upload",
  );
  const publicGalleryImages = mergeGalleryPreservingPublicEntries(
    freshContainer.publicGalleryImages,
    input.galleryEntries || [],
  );
  const container = {
    ...freshContainer,
    ...(publicGalleryImages.items.length > 0
      ? { publicGalleryImages: publicGalleryImages.items }
      : {}),
    evidenceApply: {
      ...freshEvidenceApply,
      ...queuedEvidenceApply,
      ownerReview,
      ...(sourceNotes.items.length > 0
        ? { sourceNotes: sourceNotes.items }
        : {}),
      ...(missingInfo.items.length > 0
        ? { missingInfo: missingInfo.items }
        : {}),
      ...(evidenceFieldProposals.length > 0
        ? { evidenceFieldProposals }
        : {}),
      ...(queuedMenuItems.items.length > 0
        ? { queuedMenuItems: queuedMenuItems.items }
        : {}),
      ...(queuedScheduleItems.items.length > 0
        ? { queuedScheduleItems: queuedScheduleItems.items }
        : {}),
      ...(reviewQueue.items.length > 0
        ? { reviewQueue: reviewQueue.items }
        : {}),
      ...(uploadedEvidence.items.length > 0
        ? { uploadedEvidence: uploadedEvidence.items }
        : {}),
    },
  };
  return {
    container,
    results: {
      sourceNotes,
      missingInfo,
      menuItems: queuedMenuItems,
      scheduleItems: queuedScheduleItems,
      reviewQueue,
      uploadedEvidence,
      galleryEntries: publicGalleryImages,
    },
  };
}

export function mergeProfileEvidenceQueueContainer(
  input: MergeProfileEvidenceQueueContainerInput,
): Record<string, unknown> {
  return mergeProfileEvidenceQueueContainerWithReport(input).container;
}

export function mergeProfileEvidenceApplySettings(input: {
  freshSettings: Record<string, unknown> | null | undefined;
  plannedSettings: Record<string, unknown> | null | undefined;
  galleryEntries?: readonly Record<string, unknown>[];
  reviewQueueItems?: readonly Record<string, unknown>[];
  uploadedEvidence?: readonly Record<string, unknown>[];
  publicActionLinkUpdates?: Record<string, unknown>;
}): Record<string, unknown> {
  const freshSettings = asRecord(input.freshSettings);
  const plannedSettings = asRecord(input.plannedSettings);
  const rawPlannedEvidenceApply = asRecord(plannedSettings.evidenceApply);
  const plannedEvidenceApply = Object.fromEntries(
    [
      "updatedAt",
      "sourceNotes",
      "missingInfo",
      "evidenceFieldProposals",
      "queuedMenuItems",
      "queuedScheduleItems",
      "ownerReview",
    ]
      .filter((key) => rawPlannedEvidenceApply[key] !== undefined)
      .map((key) => [key, rawPlannedEvidenceApply[key]]),
  );
  const mergedEvidence = mergeProfileEvidenceQueueContainerWithReport({
    freshContainer: freshSettings,
    queuedEvidenceApply: plannedEvidenceApply,
    galleryEntries: input.galleryEntries || [],
    reviewQueueItems: input.reviewQueueItems || [],
    uploadedEvidence: input.uploadedEvidence || [],
  }).container;
  return {
    ...freshSettings,
    publicActionLinks: {
      ...asRecord(freshSettings.publicActionLinks),
      ...asRecord(input.publicActionLinkUpdates),
    },
    evidenceApply: mergedEvidence.evidenceApply,
    ...(mergedEvidence.publicGalleryImages
      ? { publicGalleryImages: mergedEvidence.publicGalleryImages }
      : {}),
  };
}

export function buildProfileEvidenceOwnerReviewDto(input: {
  restaurantId: string;
  ledger: ProfileEvidenceReviewLedger;
  currentValues?: ProfileEvidenceCurrentValues;
  evidenceImagesById?: ProfileEvidenceOwnerImageLookup;
}): ProfileEvidenceOwnerReviewDto {
  const restaurantId = normalizeRequiredId(input.restaurantId, 200, "restaurantId");
  const normalizedLedger = normalizeProfileEvidenceReviewLedger(input.ledger, {
    restaurantId,
    fallbackReceivedAt: "1970-01-01T00:00:00.000Z",
    currentValues: input.currentValues,
  });
  const proposals = normalizedLedger.proposals
    .filter((proposal) => !normalizedLedger.decisions[proposal.id])
    .map((proposal) => {
      const definition = getProfileEvidenceFieldDefinition(proposal.field);
      const rawCurrentValue = normalizeCurrentValueForDisplay(
        input.currentValues?.[proposal.field],
      );
      const currentValue = rawCurrentValue?.slice(0, definition.maxLength) || null;
      const images = proposal.imageEvidenceIds
        .map((id) => ({
          id,
          url: sanitizeHttpUrl(input.evidenceImagesById?.[id]),
        }))
        .filter((image): image is { id: string; url: string } =>
          Boolean(image.url),
        );
      const reviewable =
        proposal.sourceKind === "screenshot"
          ? images.length > 0
          : Boolean(
              proposal.sourceUrl || proposal.evidenceExcerpt || images.length,
            );
      return {
        id: proposal.id,
        field: proposal.field,
        label: definition.label,
        valueKind: definition.valueKind,
        currentValue,
        proposedValue: proposal.proposedValue,
        confidence: proposal.confidence,
        source: {
          kind: proposal.sourceKind,
          label: proposal.sourceLabel,
          url: proposal.sourceUrl,
          excerpt: proposal.evidenceExcerpt,
          imageEvidenceIds: [...proposal.imageEvidenceIds],
          images,
          reviewable,
          unavailableReason: reviewable
            ? null
            : "The referenced screenshot is not available on this profile. Decline this suggestion or ask an admin to attach inspectable evidence.",
        },
        receivedAt: proposal.receivedAt,
        currentValueFingerprint: createProfileEvidenceValueFingerprint(
          proposal.field,
          rawCurrentValue,
        ),
      };
    });

  return {
    schemaVersion: PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
    restaurantId,
    pendingCount: proposals.length,
    proposals,
  };
}

export function isProfileEvidenceDecisionSourceInspectable(input: {
  action: "confirm" | "correct" | "decline";
  proposal?: ProfileEvidenceOwnerProposalDto;
}): boolean {
  return input.action === "decline" || input.proposal?.source.reviewable === true;
}

const invalidPlan = (
  ledger: ProfileEvidenceReviewLedger,
  code: string,
  message: string,
): ProfileEvidenceDecisionPlan => ({
  status: "invalid",
  ledger,
  code,
  message,
});

export function planProfileEvidenceReviewDecision(
  input: PlanProfileEvidenceDecisionInput,
): ProfileEvidenceDecisionPlan {
  const proposalId = String(input.proposalId || "").trim();
  if (!isSha256(proposalId)) {
    return invalidPlan(input.ledger, "invalid_proposal_id", "Proposal ID is invalid.");
  }
  const proposal = input.ledger.proposals.find((item) => item.id === proposalId);
  if (!proposal) return { status: "not_found", ledger: input.ledger };

  const actorUserId = sanitizePlainText(
    input.actorUserId,
    PROFILE_EVIDENCE_REVIEW_LIMITS.actorId,
  );
  const clientRequestId = sanitizePlainText(
    input.clientRequestId,
    PROFILE_EVIDENCE_REVIEW_LIMITS.clientRequestId,
  );
  if (!actorUserId) {
    return invalidPlan(input.ledger, "invalid_actor", "Actor is required.");
  }
  if (!clientRequestId) {
    return invalidPlan(
      input.ledger,
      "invalid_client_request_id",
      "Client request ID is required.",
    );
  }
  if (!['confirm', 'correct', 'decline'].includes(input.action)) {
    return invalidPlan(input.ledger, "invalid_action", "Decision action is invalid.");
  }

  if (!isSha256(input.expectedCurrentValueFingerprint)) {
    return invalidPlan(
      input.ledger,
      "invalid_current_fingerprint",
      "Current-value fingerprint is invalid.",
    );
  }
  let action: ProfileEvidenceDecisionAction;
  let appliedValue: string | null;
  try {
    if (input.action === "confirm") {
      action = "confirmed";
      appliedValue = normalizeProfileEvidenceReviewValue(
        proposal.field,
        proposal.proposedValue,
      );
    } else if (input.action === "correct") {
      action = "corrected";
      appliedValue = normalizeProfileEvidenceReviewValue(
        proposal.field,
        input.correctedValue,
      );
    } else {
      action = "declined";
      appliedValue = null;
    }
  } catch (error) {
    return invalidPlan(
      input.ledger,
      "invalid_corrected_value",
      error instanceof Error ? error.message : "Corrected value is invalid.",
    );
  }

  const requestFingerprint = createDecisionRequestFingerprint({
    proposalId,
    action: input.action,
    appliedValue,
    expectedCurrentValueFingerprint: input.expectedCurrentValueFingerprint,
  });
  const matchingRequestEntry = Object.entries(input.ledger.decisions).find(
    ([, decision]) =>
      decision.clientRequestId === clientRequestId &&
      decision.decidedByUserId === actorUserId,
  );
  if (matchingRequestEntry) {
    const [storedProposalId, matchingRequestDecision] = matchingRequestEntry;
    const storedRequestFingerprint =
      matchingRequestDecision.requestFingerprint ||
      createDecisionRequestFingerprint({
        proposalId: storedProposalId,
        action: requestActionForStoredDecision(matchingRequestDecision.action),
        appliedValue: matchingRequestDecision.appliedValue,
        expectedCurrentValueFingerprint:
          matchingRequestDecision.previousValueFingerprint,
      });
    if (storedRequestFingerprint === requestFingerprint) {
      return {
        status: "idempotent",
        ledger: input.ledger,
        decision: matchingRequestDecision,
        mutation: null,
      };
    }
    return {
      status: "conflict",
      ledger: input.ledger,
      decision: matchingRequestDecision,
    };
  }
  const existingDecision = input.ledger.decisions[proposal.id];
  if (existingDecision) {
    return {
      status: "conflict",
      ledger: input.ledger,
      decision: existingDecision,
    };
  }

  const currentValueFingerprint = createProfileEvidenceValueFingerprint(
    proposal.field,
    input.currentValue,
  );
  if (currentValueFingerprint !== input.expectedCurrentValueFingerprint) {
    return {
      status: "stale",
      ledger: input.ledger,
      currentValueFingerprint,
    };
  }

  const decidedAtMs = Date.parse(String(input.decidedAt || ""));
  if (!Number.isFinite(decidedAtMs)) {
    return invalidPlan(
      input.ledger,
      "invalid_decided_at",
      "Decision timestamp is invalid.",
    );
  }
  const previousValue = normalizeCurrentValueForDisplay(
    input.currentValue,
    getProfileEvidenceFieldDefinition(proposal.field).maxLength,
  );
  const decision: ProfileEvidenceReviewDecision = {
    action,
    appliedValue,
    previousValue,
    previousValueFingerprint: currentValueFingerprint,
    decidedAt: new Date(decidedAtMs).toISOString(),
    decidedByUserId: actorUserId,
    clientRequestId,
    requestFingerprint,
  };
  const nextLedger: ProfileEvidenceReviewLedger = {
    schemaVersion: PROFILE_EVIDENCE_REVIEW_SCHEMA_VERSION,
    proposals: [...input.ledger.proposals],
    decisions: {
      ...input.ledger.decisions,
      [proposal.id]: decision,
    },
  };
  const currentComparable = normalizeCurrentValueForDisplay(input.currentValue);
  const mutation =
    appliedValue === null || appliedValue === currentComparable
      ? null
      : {
          field: proposal.field,
          destination: getProfileEvidenceFieldDefinition(proposal.field).destination,
          previousValue: currentComparable,
          nextValue: appliedValue,
        };

  return {
    status: "planned",
    ledger: nextLedger,
    decision,
    mutation,
  };
}
