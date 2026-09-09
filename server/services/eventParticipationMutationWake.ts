import { sql } from "drizzle-orm";
import { db } from "../db";

const clean = (value: unknown) => String(value || "").trim();

/**
 * Provider, arrival, and notification work completes outside the parent
 * mutation transaction. Waking by the immutable child identity lets the
 * recurring reconciler converge the exact parent without a route having to
 * call its resume helper.
 */
export async function wakeEventParticipationMutationsForBookings(
  bookingIds: string[],
  reason: string,
  database: any = db,
) {
  const stableIds = Array.from(
    new Set(bookingIds.map(clean).filter(Boolean)),
  ).sort();
  if (stableIds.length === 0) return [] as string[];
  const result = await database.execute(sql`
    UPDATE event_participation_mutations parent
       SET recovery_requested_at = now(),
           last_recovery_reason = ${clean(reason) || "child_state_changed"},
           updated_at = now()
     WHERE parent.status NOT IN ('converged', 'failed')
       AND EXISTS (
         SELECT 1
           FROM event_participation_mutation_children child
          WHERE child.mutation_id = parent.id
            AND child.booking_id IN (${sql.join(
              stableIds.map((id) => sql`${id}`),
              sql`, `,
            )})
       )
     RETURNING parent.id
  `);
  return ((result as any).rows || []).map((row: any) => clean(row.id));
}

export async function wakeEventParticipationMutationForCancellation(
  cancellationOperationId: string,
  reason: string,
  database: any = db,
) {
  const operationId = clean(cancellationOperationId);
  if (!operationId) return [] as string[];
  const result = await database.execute(sql`
    UPDATE event_participation_mutations parent
       SET recovery_requested_at = now(),
           last_recovery_reason = ${clean(reason) || "provider_state_changed"},
           updated_at = now()
     WHERE parent.status NOT IN ('converged', 'failed')
       AND EXISTS (
         SELECT 1
           FROM event_participation_mutation_children child
          WHERE child.mutation_id = parent.id
            AND child.cancellation_operation_id = ${operationId}
       )
     RETURNING parent.id
  `);
  return ((result as any).rows || []).map((row: any) => clean(row.id));
}
