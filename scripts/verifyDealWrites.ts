/**
 * Database verification for deal creation contract
 * 
 * This script queries the database to verify that:
 * - Recent deals have correct null values based on checkbox states
 * - imageUrl is never null
 * - Boolean flags match expected null patterns
 * 
 * Run: node --env-file=.env --import tsx scripts/verifyDealWrites.ts
 */

import { db } from "../server/db";
import { deals } from "../shared/schema";
import { desc } from "drizzle-orm";

console.log("🔍 Verifying Deal Writes (Recent 10 Deals)\n");
console.log("=" .repeat(90));

async function verifyDeals() {
  const recentDeals = await db
    .select({
      id: deals.id,
      title: deals.title,
      imageUrl: deals.imageUrl,
      businessHours: deals.availableDuringBusinessHours,
      startTime: deals.startTime,
      endTime: deals.endTime,
      isOngoing: deals.isOngoing,
      endDate: deals.endDate,
      createdAt: deals.createdAt,
    })
    .from(deals)
    .orderBy(desc(deals.createdAt))
    .limit(10);

  if (recentDeals.length === 0) {
    console.log("ℹ️  No deals found in database");
    console.log("   Create some deals first, then run this verification");
    process.exit(0);
  }

  console.log(`Found ${recentDeals.length} recent deals:\n`);

  let allValid = true;
  const issues: string[] = [];

  recentDeals.forEach((deal: any, index: number) => {
    const dealNum = index + 1;
    console.log(`${dealNum}. ${deal.title} (${deal.id})`);
    console.log(`   Created: ${deal.createdAt?.toLocaleString() || "Unknown"}`);
    console.log(`   Image URL: ${deal.imageUrl ? "✅ Set" : "❌ NULL (INVALID)"}`);
    console.log(`   Business Hours: ${deal.businessHours ? "Yes" : "No"}`);
    console.log(`   Start Time: ${deal.startTime || "NULL"}`);
    console.log(`   End Time: ${deal.endTime || "NULL"}`);
    console.log(`   Ongoing: ${deal.isOngoing ? "Yes" : "No"}`);
    console.log(`   End Date: ${deal.endDate ? deal.endDate.toISOString().split("T")[0] : "NULL"}`);

    // Validation: imageUrl must never be null
    if (!deal.imageUrl) {
      issues.push(`Deal ${dealNum} (${deal.id}): imageUrl is NULL - CONSTRAINT VIOLATION`);
      allValid = false;
    }

    // Validation: if businessHours=true, times should be null
    if (deal.businessHours && (deal.startTime || deal.endTime)) {
      issues.push(
        `Deal ${dealNum} (${deal.id}): Business hours=true but times not null - LOGIC VIOLATION`
      );
      allValid = false;
    }

    // Validation: if isOngoing=true, endDate should be null
    if (deal.isOngoing && deal.endDate) {
      issues.push(
        `Deal ${dealNum} (${deal.id}): Ongoing=true but endDate not null - LOGIC VIOLATION`
      );
      allValid = false;
    }

    // Info: Check expected patterns
    if (deal.businessHours && !deal.startTime && !deal.endTime) {
      console.log(`   ✅ Correct: Business hours enabled → times are NULL`);
    }
    if (deal.isOngoing && !deal.endDate) {
      console.log(`   ✅ Correct: Ongoing deal → endDate is NULL`);
    }

    console.log();
  });

  console.log("=" .repeat(90));

  if (allValid) {
    console.log("✅ ALL DEALS VALID");
    console.log("\n📌 Verification Summary:");
    console.log(`   • ${recentDeals.length} deals checked`);
    console.log("   • All imageUrl fields are non-null");
    console.log("   • Business hours checkbox → null times (where applicable)");
    console.log("   • Ongoing checkbox → null endDate (where applicable)");
    console.log("\n🔒 Contract is working correctly in production");
    process.exit(0);
  } else {
    console.log("❌ VALIDATION ISSUES FOUND\n");
    issues.forEach((issue) => console.log(`   • ${issue}`));
    console.log("\n⚠️  Database contains deals that violate the contract");
    console.log("   This indicates either:");
    console.log("   - UI validation was bypassed");
    console.log("   - Backend normalization failed");
    console.log("   - Database constraints not enforced");
    process.exit(1);
  }
}

verifyDeals().catch((error) => {
  console.error("❌ Database query failed:", error);
  process.exit(1);
});
