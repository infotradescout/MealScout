import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "./db";
import {
  creditLedger,
  mealScoutCreditEvents,
  userReviewerLevels,
  type MealScoutCreditEvent,
} from "@shared/schema";

type CreditActionRule = {
  action: string;
  label: string;
  baseCreditAmountCents: number;
  creditAmountCents: number;
  category: "account" | "profile" | "business" | "community" | "growth";
  description: string;
  tierMultiplierEligible: boolean;
  maxAwardsPerUser?: number;
  enabled: boolean;
};

const CREDIT_TIER_MULTIPLIERS: Record<number, number> = {
  1: 1,
  2: 1.1,
  3: 1.25,
  4: 1.5,
  5: 1.75,
  6: 2,
};

const createCreditActionRule = (
  rule: Omit<CreditActionRule, "creditAmountCents">,
): CreditActionRule => ({
  ...rule,
  creditAmountCents: rule.baseCreditAmountCents,
});

const CREDIT_ACTION_RULES = {
  signup_customer: createCreditActionRule({
    action: "signup_customer",
    label: "Customer signup",
    baseCreditAmountCents: 25,
    category: "account",
    description: "A new customer account is created.",
    tierMultiplierEligible: false,
    enabled: true,
  }),
  signup_business: createCreditActionRule({
    action: "signup_business",
    label: "Business signup",
    baseCreditAmountCents: 100,
    category: "account",
    description: "A food truck, restaurant, supplier, or host account is created.",
    tierMultiplierEligible: false,
    enabled: true,
  }),
  email_verified: createCreditActionRule({
    action: "email_verified",
    label: "Email verified",
    baseCreditAmountCents: 25,
    category: "account",
    description: "The user verifies their email address.",
    tierMultiplierEligible: false,
    enabled: true,
  }),
  profile_completed: createCreditActionRule({
    action: "profile_completed",
    label: "Profile completed",
    baseCreditAmountCents: 200,
    category: "profile",
    description: "A public profile reaches the launch-ready threshold.",
    tierMultiplierEligible: false,
    enabled: true,
  }),
  insurance_submitted: createCreditActionRule({
    action: "insurance_submitted",
    label: "Insurance submitted",
    baseCreditAmountCents: 125,
    category: "business",
    description: "A business submits commercial insurance verification.",
    tierMultiplierEligible: false,
    enabled: true,
  }),
  job_post_created: createCreditActionRule({
    action: "job_post_created",
    label: "Hiring post created",
    baseCreditAmountCents: 50,
    category: "business",
    description: "A business or host opens a hiring post.",
    tierMultiplierEligible: false,
    enabled: true,
  }),
  help_wanted_enabled: createCreditActionRule({
    action: "help_wanted_enabled",
    label: "Help wanted enabled",
    baseCreditAmountCents: 35,
    category: "business",
    description: "A business toggles on a profile hiring banner.",
    tierMultiplierEligible: false,
    enabled: true,
  }),
  menu_item_added: createCreditActionRule({
    action: "menu_item_added",
    label: "Menu item added",
    baseCreditAmountCents: 8,
    category: "profile",
    description: "A business adds a menu item.",
    tierMultiplierEligible: false,
    enabled: true,
  }),
  share_link_created: createCreditActionRule({
    action: "share_link_created",
    label: "Share link created",
    baseCreditAmountCents: 5,
    category: "growth",
    description: "A user creates or copies a share link.",
    tierMultiplierEligible: true,
    enabled: true,
  }),
  referral_click: createCreditActionRule({
    action: "referral_click",
    label: "Referral click",
    baseCreditAmountCents: 3,
    category: "growth",
    description: "Someone lands through a credited referral link.",
    tierMultiplierEligible: true,
    enabled: true,
  }),
  review_written: createCreditActionRule({
    action: "review_written",
    label: "Review written",
    baseCreditAmountCents: 35,
    category: "community",
    description: "A user writes a useful review.",
    tierMultiplierEligible: true,
    enabled: true,
  }),
  favorite_added: createCreditActionRule({
    action: "favorite_added",
    label: "Favorite added",
    baseCreditAmountCents: 75,
    category: "community",
    description:
      "A user spends one of their limited favorite slots on a business or deal.",
    tierMultiplierEligible: true,
    maxAwardsPerUser: 3,
    enabled: true,
  }),
  follow_added: createCreditActionRule({
    action: "follow_added",
    label: "Follow added",
    baseCreditAmountCents: 10,
    category: "community",
    description: "A user follows a business or host.",
    tierMultiplierEligible: true,
    enabled: true,
  }),
} satisfies Record<string, CreditActionRule>;

export type MealScoutCreditAction = keyof typeof CREDIT_ACTION_RULES;

export type RecordMealScoutCreditActionInput = {
  userId: string;
  action: MealScoutCreditAction;
  sourceId: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export function getMealScoutCreditActionCatalog() {
  return Object.values(CREDIT_ACTION_RULES).map((rule) => ({
    ...rule,
    baseCreditAmountDollars: creditCentsToDollars(rule.baseCreditAmountCents),
    creditAmountDollars: creditCentsToDollars(rule.creditAmountCents),
    formula: rule.tierMultiplierEligible
      ? `round(${rule.baseCreditAmountCents} base cents * user tier multiplier) / 100`
      : `${rule.baseCreditAmountCents} cents / 100 = $${creditCentsToDollars(rule.baseCreditAmountCents).toFixed(2)}`,
  }));
}

function toCreditAmount(cents: number) {
  return (cents / 100).toFixed(2);
}

function creditCentsToDollars(cents: number) {
  return Number((cents / 100).toFixed(2));
}

function toNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getCreditUserLevel(userId: string) {
  const [row] = await db
    .select({ level: userReviewerLevels.level })
    .from(userReviewerLevels)
    .where(eq(userReviewerLevels.userId, userId))
    .limit(1);

  const level = Math.min(Math.max(toNumber(row?.level) || 1, 1), 6);
  return level;
}

function getCreditAmountForRule(rule: CreditActionRule, userLevel: number) {
  const multiplier = rule.tierMultiplierEligible
    ? CREDIT_TIER_MULTIPLIERS[userLevel] || 1
    : 1;
  return {
    userLevel,
    multiplier,
    creditAmountCents: Math.round(rule.baseCreditAmountCents * multiplier),
  };
}

export async function recordMealScoutCreditAction(
  input: RecordMealScoutCreditActionInput,
): Promise<
  | {
      credited: true;
      event: MealScoutCreditEvent;
      creditAmountCents: number;
    }
  | {
      credited: false;
      reason:
        | "disabled"
        | "duplicate"
        | "invalid_amount"
        | "max_awards_reached";
      existingEvent?: MealScoutCreditEvent;
      creditAmountCents: number;
    }
> {
  const rule = CREDIT_ACTION_RULES[input.action];
  const userId = String(input.userId || "").trim();
  const sourceId = String(input.sourceId || "").trim();
  const userLevel = userId ? await getCreditUserLevel(userId) : 1;
  const creditAward = rule
    ? getCreditAmountForRule(rule, userLevel)
    : { userLevel, multiplier: 1, creditAmountCents: 0 };
  const creditAmountCents = creditAward.creditAmountCents;
  if (!rule?.enabled) {
    return { credited: false, reason: "disabled", creditAmountCents };
  }
  if (creditAmountCents <= 0) {
    return { credited: false, reason: "invalid_amount", creditAmountCents };
  }

  if (!userId || !sourceId) {
    throw new Error("userId and sourceId are required to record credits");
  }

  const sourceType = `interaction:${rule.action}`;

  if (rule.maxAwardsPerUser) {
    const [awardCount] = await db
      .select({
        count: sql<number>`count(*)::int`.mapWith(Number),
      })
      .from(mealScoutCreditEvents)
      .where(
        and(
          eq(mealScoutCreditEvents.userId, userId),
          eq(mealScoutCreditEvents.action, rule.action),
        ),
      );
    if (toNumber(awardCount?.count) >= rule.maxAwardsPerUser) {
      return {
        credited: false,
        reason: "max_awards_reached",
        creditAmountCents,
      };
    }
  }

  const [existingEvent] = await db
    .select()
    .from(mealScoutCreditEvents)
    .where(
      and(
        eq(mealScoutCreditEvents.userId, userId),
        eq(mealScoutCreditEvents.sourceType, sourceType),
        eq(mealScoutCreditEvents.sourceId, sourceId),
      ),
    )
    .limit(1);

  if (existingEvent) {
    return {
      credited: false,
      reason: "duplicate",
      existingEvent,
      creditAmountCents,
    };
  }

  const [event] = await db.transaction(async (tx: any) => {
    const [ledgerEntry] = await tx
      .insert(creditLedger)
      .values({
        userId,
        amount: toCreditAmount(creditAmountCents),
        sourceType,
        sourceId,
      })
      .returning();

    return tx
      .insert(mealScoutCreditEvents)
      .values({
        userId,
        action: rule.action,
        sourceType,
        sourceId,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        creditAmountCents,
        creditLedgerId: ledgerEntry.id,
        metadata: {
          ...(input.metadata || {}),
          creditFormula: {
            baseCreditAmountCents: rule.baseCreditAmountCents,
            userLevel: creditAward.userLevel,
            tierMultiplier: creditAward.multiplier,
            creditAmountCents,
            maxAwardsPerUser: rule.maxAwardsPerUser || null,
          },
        },
      })
      .returning();
  });

  return { credited: true, event, creditAmountCents };
}

export async function getMealScoutCreditEvents(params: {
  userId?: string;
  action?: string;
  limit?: number;
}) {
  const clauses = [];
  if (params.userId) clauses.push(eq(mealScoutCreditEvents.userId, params.userId));
  if (params.action) clauses.push(eq(mealScoutCreditEvents.action, params.action));

  return db
    .select()
    .from(mealScoutCreditEvents)
    .where(clauses.length ? and(...clauses) : sql`true`)
    .orderBy(desc(mealScoutCreditEvents.createdAt))
    .limit(Math.min(Math.max(params.limit || 100, 1), 500));
}

export async function getMealScoutCreditUserSummaries(params: {
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(Math.max(params.limit || 100, 1), 500);
  const offset = Math.max(params.offset || 0, 0);
  const search = String(params.search || "").trim();
  const searchPattern = `%${search}%`;

  const result = await db.execute(sql`
    with interaction_totals as (
      select
        user_id,
        count(*)::int as interaction_event_count,
        coalesce(sum(credit_amount_cents), 0)::int as interaction_earned_cents,
        max(created_at) as last_credit_event_at
      from mealscout_credit_events
      group by user_id
    ),
    ledger_totals as (
      select
        user_id,
        coalesce(sum(amount) filter (where redeemed_at is null), 0)::numeric(10,2) as available_credit_amount,
        coalesce(sum(amount) filter (
          where redeemed_at is null and source_type like 'interaction:%'
        ), 0)::numeric(10,2) as available_interaction_credit_amount,
        coalesce(sum(amount) filter (
          where redeemed_at is null and source_type not like 'interaction:%'
        ), 0)::numeric(10,2) as available_affiliate_or_other_credit_amount,
        coalesce(sum(amount) filter (where redeemed_at is not null), 0)::numeric(10,2) as redeemed_credit_amount,
        coalesce(sum(amount) filter (where source_type like 'interaction:%'), 0)::numeric(10,2) as lifetime_interaction_ledger_amount,
        coalesce(sum(amount) filter (where source_type not like 'interaction:%'), 0)::numeric(10,2) as lifetime_affiliate_or_other_ledger_amount,
        coalesce(sum(amount), 0)::numeric(10,2) as lifetime_ledger_amount
      from credit_ledger
      group by user_id
    )
    select
      u.id,
      u.email,
      u.first_name,
      u.last_name,
      u.user_type,
      u.affiliate_tag,
      u.created_at,
      coalesce(it.interaction_event_count, 0)::int as interaction_event_count,
      coalesce(it.interaction_earned_cents, 0)::int as interaction_earned_cents,
      it.last_credit_event_at,
      coalesce(lt.available_credit_amount, 0)::numeric(10,2) as available_credit_amount,
      coalesce(lt.available_interaction_credit_amount, 0)::numeric(10,2) as available_interaction_credit_amount,
      coalesce(lt.available_affiliate_or_other_credit_amount, 0)::numeric(10,2) as available_affiliate_or_other_credit_amount,
      coalesce(lt.redeemed_credit_amount, 0)::numeric(10,2) as redeemed_credit_amount,
      coalesce(lt.lifetime_interaction_ledger_amount, 0)::numeric(10,2) as lifetime_interaction_ledger_amount,
      coalesce(lt.lifetime_affiliate_or_other_ledger_amount, 0)::numeric(10,2) as lifetime_affiliate_or_other_ledger_amount,
      coalesce(lt.lifetime_ledger_amount, 0)::numeric(10,2) as lifetime_ledger_amount
    from users u
    left join interaction_totals it on it.user_id = u.id
    left join ledger_totals lt on lt.user_id = u.id
    where ${search ? sql`
      u.email ilike ${searchPattern}
      or u.first_name ilike ${searchPattern}
      or u.last_name ilike ${searchPattern}
      or u.affiliate_tag ilike ${searchPattern}
      or u.id ilike ${searchPattern}
    ` : sql`true`}
    order by
      coalesce(it.last_credit_event_at, u.created_at) desc nulls last,
      u.created_at desc nulls last
    limit ${limit}
    offset ${offset}
  `);

  return (result.rows || []).map((row: any) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    displayName:
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
      row.email ||
      row.id,
    userType: row.user_type,
    affiliateTag: row.affiliate_tag,
    createdAt: row.created_at,
    interactionEventCount: toNumber(row.interaction_event_count),
    interactionEarnedCents: toNumber(row.interaction_earned_cents),
    interactionEarnedDollars: creditCentsToDollars(
      toNumber(row.interaction_earned_cents),
    ),
    availableCreditDollars: toNumber(row.available_credit_amount),
    availableInteractionCreditDollars: toNumber(
      row.available_interaction_credit_amount,
    ),
    availableAffiliateOrOtherCreditDollars: toNumber(
      row.available_affiliate_or_other_credit_amount,
    ),
    redeemedCreditDollars: toNumber(row.redeemed_credit_amount),
    lifetimeInteractionLedgerDollars: toNumber(
      row.lifetime_interaction_ledger_amount,
    ),
    lifetimeAffiliateOrOtherLedgerDollars: toNumber(
      row.lifetime_affiliate_or_other_ledger_amount,
    ),
    lifetimeLedgerDollars: toNumber(row.lifetime_ledger_amount),
    lastCreditEventAt: row.last_credit_event_at,
  }));
}

export async function getMealScoutCreditUserSummary(userId: string) {
  const [summary] = await getMealScoutCreditUserSummaries({
    search: userId,
    limit: 1,
  });

  const breakdownResult = await db.execute(sql`
    select
      action,
      count(*)::int as event_count,
      coalesce(sum(credit_amount_cents), 0)::int as earned_cents,
      max(created_at) as last_event_at
    from mealscout_credit_events
    where user_id = ${userId}
    group by action
    order by earned_cents desc, event_count desc, action asc
  `);

  const breakdown = (breakdownResult.rows || []).map((row: any) => ({
    action: row.action,
    eventCount: toNumber(row.event_count),
    earnedCents: toNumber(row.earned_cents),
    earnedDollars: creditCentsToDollars(toNumber(row.earned_cents)),
    lastEventAt: row.last_event_at,
    rule:
      CREDIT_ACTION_RULES[row.action as MealScoutCreditAction] ||
      null,
  }));

  const events = await getMealScoutCreditEvents({ userId, limit: 100 });

  return {
    summary: summary || null,
    breakdown,
    events,
    formula: getMealScoutCreditFormula(),
  };
}

export function getMealScoutCreditFormula() {
  return {
    unit: "USD credits",
    storage: "Rules store integer cents. credit_ledger stores decimal dollars.",
    stacking:
      "MealScout interaction credits are earned on top of affiliate payouts and do not reduce affiliate commissions.",
    awardFormula:
      "earnedCreditDollars = round(action.baseCreditAmountCents * userTierMultiplier) / 100 for tier-eligible actions; otherwise baseCreditAmountCents / 100",
    tierMultipliers: CREDIT_TIER_MULTIPLIERS,
    tierSource:
      "user_reviewer_levels.level, defaulting to level 1 when a user has no reviewer level row",
    scarcityRule:
      "Scarce actions can define maxAwardsPerUser. Favorites currently grant credits only for the first 3 favorite_added events per user.",
    affiliateSeparation:
      "interaction credits use source_type = interaction:<action>; affiliate and commission payouts keep their existing non-interaction source types.",
    balanceFormula:
      "availableCreditDollars = SUM(credit_ledger.amount WHERE user_id = user AND redeemed_at IS NULL)",
    adminSplitFormula:
      "availableInteractionCreditDollars = SUM(credit_ledger.amount WHERE source_type LIKE 'interaction:%' AND redeemed_at IS NULL); availableAffiliateOrOtherCreditDollars = SUM(non-interaction ledger credits still available)",
    idempotencyFormula:
      "one award per user_id + source_type + source_id in mealscout_credit_events",
    rules: getMealScoutCreditActionCatalog(),
  };
}
