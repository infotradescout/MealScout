/**
 * PHASE 6: Empty County Experience Service
 * 
 * When a county has 0 restaurants:
 * 1. Show acknowledgement message
 * 2. Show "Be an early backer" reframe
 * 3. Show "Submit favorite" form
 * 4. Show affiliate link CTA
 */

import { db } from './db';
import { restaurants } from '@shared/schema';
import { and, eq, sql } from 'drizzle-orm';
import { toPublicRestaurantListingArrayWithVisibility } from './publicProfiles/toPublicRestaurantListingWithVisibility';
import { isPublicBusinessVisible } from './utils/publicBusinessVisibility';

const normalizedArea = (value: unknown) =>
  String(value || '').trim().toLowerCase().slice(0, 100);

async function loadPublicRestaurantsForArea(input: {
  state: string;
  county?: string;
  limit: number;
}) {
  const state = normalizedArea(input.state);
  const county = normalizedArea(input.county);
  if (!state) return [];
  const rows = await db
    .select()
    .from(restaurants)
    .where(
      and(
        eq(restaurants.isActive, true),
        eq(sql`lower(coalesce(${restaurants.state}, ''))`, state),
        county
          ? eq(sql`lower(coalesce(${restaurants.countyName}, ''))`, county)
          : undefined,
      ),
    )
    .limit(Math.max(input.limit, 100));
  return (
    await toPublicRestaurantListingArrayWithVisibility(
      rows.filter((row: any) => isPublicBusinessVisible(row)),
    )
  ).slice(0, input.limit);
}

/**
 * Check if a county is empty (has no restaurants)
 */
export async function isCountyEmpty(county: string, state: string): Promise<boolean> {
  try {
    const result = await loadPublicRestaurantsForArea({
      county,
      state,
      limit: 1,
    });
    return result.length === 0;
  } catch (error) {
    console.error('[emptyCountyService] Error checking if county is empty:', error);
    return true; // Assume empty if we can't check
  }
}

/**
 * Get empty county experience data
 * 
 * Returns messaging and CTAs for empty counties
 */
export async function getEmptyCountyExperience(county: string, state: string) {
  try {
    const isEmpty = await isCountyEmpty(county, state);

    if (!isEmpty) {
      return {
        isEmpty: false,
        message: null,
      };
    }

    // County is empty - return full experience data
    return {
      isEmpty: true,
      county,
      state,
      experience: {
        step1: {
          title: 'No Partners Yet',
          message: `${county} County, ${state} doesn't have any partner restaurants on MealScout yet.`,
          icon: 'alert',
        },
        step2: {
          title: 'Be an Early Backer',
          message: `You're early. Help grow the platform and earn money when restaurants sign up.`,
          icon: 'heart',
        },
        step3: {
          title: 'Know a Great Spot?',
          message: `Tell us about your favorite restaurant. We'll reach out to them.`,
          cta: 'Submit Restaurant',
          icon: 'mappin',
        },
        step4: {
          title: 'Earn & Give Back',
          message: `When restaurants join MealScout, you earn credits that can be spent locally or cashed out.`,
          icon: 'gift',
        },
      },
      userCanEarn: true, // User can share referral link and earn
    };
  } catch (error) {
    console.error('[emptyCountyService] Error getting empty county experience:', error);
    throw error;
  }
}

/**
 * Get nearby counties with restaurants (fallback content)
 * 
 * Returns restaurants from neighboring counties
 */
export async function getNearbyCountyFallback(county: string, state: string) {
  try {
    // This endpoint promises a state-wide fallback. It must never substitute
    // arbitrary national rows or expose raw restaurant records.
    const stateRestaurants = await loadPublicRestaurantsForArea({
      state,
      limit: 25,
    });
    const requestedCounty = normalizedArea(county);
    const nearbyRestaurants = stateRestaurants
      .filter(
        (restaurant: any) =>
          normalizedArea(restaurant.countyName) !== requestedCounty,
      )
      .slice(0, 10);

    return {
      fallbackType: nearbyRestaurants.length ? 'state_wide' : 'empty',
      message: nearbyRestaurants.length
        ? `Showing restaurants from across ${state}`
        : `No public restaurants are available elsewhere in ${state} yet.`,
      restaurants: nearbyRestaurants,
    };
  } catch (error) {
    console.error('[emptyCountyService] Error getting nearby fallback:', error);
    throw error;
  }
}

export default {
  isCountyEmpty,
  getEmptyCountyExperience,
  getNearbyCountyFallback,
};
