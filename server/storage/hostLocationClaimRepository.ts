import {
  hostLocationClaims,
  locationRequests,
  type HostLocationClaim,
  type InsertHostLocationClaim,
} from "@shared/schema";
import { db } from "../db";
import { and, eq } from "drizzle-orm";

export function createHostLocationClaimRepository() {
  return {
    async createHostLocationClaim(
      claim: InsertHostLocationClaim,
    ): Promise<HostLocationClaim> {
      const [created] = await db
        .insert(hostLocationClaims)
        .values({
          ...claim,
          message: claim.message?.trim() || null,
        })
        .returning();

      await db
        .update(locationRequests)
        .set({ demandStatus: "claimed" })
        .where(
          and(
            eq(locationRequests.id, claim.locationRequestId),
            eq(locationRequests.status, "open"),
          ),
        );

      return created;
    },

    async convertHostLocationClaim(
      claimId: string,
      hostId: string,
      claimingUserId: string,
    ): Promise<void> {
      await db.transaction(async (tx: any) => {
        const [claim] = await tx
          .select()
          .from(hostLocationClaims)
          .where(
            and(
              eq(hostLocationClaims.id, claimId),
              eq(hostLocationClaims.claimedByUserId, claimingUserId),
            ),
          );
        if (!claim) {
          throw new Error("Host location claim not found");
        }

        await tx
          .update(hostLocationClaims)
          .set({
            status: "converted",
            hostId,
            resolvedAt: new Date(),
          })
          .where(eq(hostLocationClaims.id, claimId));

        await tx
          .update(locationRequests)
          .set({
            status: "fulfilled",
            demandStatus: "fulfilled",
          })
          .where(eq(locationRequests.id, claim.locationRequestId));
      });
    },
  };
}
