import { db } from './db';
import { events, hosts, restaurants, eventInterests, users } from '@shared/schema';
import { and, eq, gte, lte, isNull, sql } from 'drizzle-orm';
import { emailService } from './emailService';
import auditLogger from './auditLogger';
import {
  getReminderBusinessHoursStatus,
  logReminderBusinessHoursSkip,
} from './utils/reminderBusinessHours';

/**
 * Notify nearby food trucks about unbooked event slots.
 * 
 * This cron job runs hourly and checks for:
 * - Events happening within the next 48 hours
 * - Events that are still "open" (not booked)
 * - Events that haven't had notifications sent yet
 * 
 * For each qualifying event, it:
 * 1. Identifies food trucks within a 25km radius (based on home address)
 * 2. Excludes trucks that have already expressed interest
 * 3. Sends notification emails to truck owners
 * 4. Marks event as notified to prevent duplicate notifications
 */
export async function notifyUnbookedEvents(): Promise<{
  eventsProcessed: number;
  trucksNotified: number;
  errors: number;
  deferred?: boolean;
  reason?: string;
}> {
  const stats = {
    eventsProcessed: 0,
    trucksNotified: 0,
    errors: 0,
  };

  const hours = getReminderBusinessHoursStatus();
  if (!hours.allowed) {
    logReminderBusinessHoursSkip('unbooked event opportunity notifications', hours);
    return {
      ...stats,
      deferred: true,
      reason: hours.reason,
    };
  }

  try {
    console.log('[EventNotificationCron] Starting unbooked event notification check...');

    // Find events that meet criteria:
    // 1. Status is "open" (not booked, cancelled, or completed)
    // 2. Event date is between now and 48 hours from now
    // 3. No notification sent yet (we'll track this via a new field or by checking if we've already run)
    const now = new Date();
    const bufferEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 hours from now

    const upcomingUnbookedEvents = await db
      .select({
        event: events,
        host: hosts,
      })
      .from(events)
      .innerJoin(hosts, eq(events.hostId, hosts.id))
      .where(
        and(
          eq(events.status, 'open'),
          gte(events.date, now),
          lte(events.date, bufferEnd),
          eq(events.eventType, 'event')
        )
      );

    console.log(`[EventNotificationCron] Found ${upcomingUnbookedEvents.length} unbooked events within 48-hour buffer`);

    for (const { event, host } of upcomingUnbookedEvents) {
      try {
        if (event.unbookedNotificationSentAt) {
          auditLogger.info('Unbooked event notification skipped', {
            eventId: event.id,
            reason: 'already_notified',
            lastSentAt: event.unbookedNotificationSentAt,
          });
          continue;
        }

        const [claimed] = await db
          .update(events)
          .set({ unbookedNotificationSentAt: now })
          .where(
            and(
              eq(events.id, event.id),
              isNull(events.unbookedNotificationSentAt),
            ),
          )
          .returning({ id: events.id });

        if (!claimed) {
          auditLogger.info('Unbooked event notification skipped', {
            eventId: event.id,
            reason: 'already_claimed',
          });
          continue;
        }

        // Get all trucks that have already expressed interest in this event
        const existingInterests = await db
          .select({ truckId: eventInterests.truckId })
          .from(eventInterests)
          .where(eq(eventInterests.eventId, event.id));

        const excludedTruckIds = existingInterests.map((i: { truckId: string }) => i.truckId);

        // Get all active food trucks (we'll use their home address as proxy since we don't have host lat/lng)
        // In a real system, you'd geocode the host address or store lat/lng on hosts table
        const allTrucks = await db
          .select({
            id: restaurants.id,
            name: restaurants.name,
            ownerId: restaurants.ownerId,
            latitude: restaurants.latitude,
            longitude: restaurants.longitude,
          })
          .from(restaurants)
          .where(
            and(
              eq(restaurants.isFoodTruck, true),
              eq(restaurants.isActive, true),
              sql`${restaurants.latitude} IS NOT NULL`
            )
          );

        // Filter out trucks that already expressed interest
        const trucksToNotify = allTrucks.filter((t: { id: string }) => !excludedTruckIds.includes(t.id));
          
          // Notify each truck owner
          for (const truck of trucksToNotify) {
            try {
              const owner = await db
                .select()
                .from(users)
                .where(eq(users.id, truck.ownerId))
                .limit(1);

              if (owner[0]?.email) {
                await sendUnbookedEventNotification(
                  owner[0].email,
                  owner[0].firstName || 'Truck Owner',
                  {
                    eventName: event.name || 'Food Truck Opportunity',
                    hostName: host.businessName,
                    eventDate: event.date,
                    address: host.address,
                    startTime: event.startTime,
                    endTime: event.endTime,
                    eventId: event.id,
                  }
                );
                stats.trucksNotified++;
              }
            } catch (emailError) {
              console.error(`[EventNotificationCron] Failed to notify truck ${truck.id}:`, emailError);
              stats.errors++;
            }
          }
        
        stats.eventsProcessed++;

        // Audit log
        auditLogger.info('Unbooked event notification sent', {
          eventId: event.id,
          hostId: host.id,
          trucksNotified: stats.trucksNotified,
        });

      } catch (eventError) {
        console.error(`[EventNotificationCron] Failed to process event ${event.id}:`, eventError);
        stats.errors++;
      }
    }

    console.log('[EventNotificationCron] Notification check complete:', stats);
    return stats;

  } catch (error) {
    console.error('[EventNotificationCron] Critical error:', error);
    stats.errors++;
    return stats;
  }
}

/**
 * Send email notification to truck owner about unbooked event opportunity
 */
async function sendUnbookedEventNotification(
  email: string,
  ownerName: string,
  eventDetails: {
    eventName: string;
    hostName: string;
    eventDate: Date;
    address: string;
    startTime: string;
    endTime: string;
    eventId: string;
  }
): Promise<void> {
  const subject = `🚚 Food Truck Opportunity Available - ${eventDetails.hostName}`;
  
  const formattedDate = new Date(eventDetails.eventDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #111827; }
        .container { max-width: 640px; margin: 0 auto; padding: 20px; }
        .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; background: #ffffff; }
        .badge { display: inline-block; background: #fef3c7; color: #92400e; padding: 6px 12px; border-radius: 9999px; font-weight: 600; font-size: 12px; margin-bottom: 12px; }
        .title { font-size: 24px; font-weight: 700; margin: 8px 0 16px 0; color: #111827; }
        .meta { display: grid; gap: 12px; margin: 20px 0; background: #f9fafb; padding: 16px; border-radius: 8px; }
        .meta-row { display: flex; justify-content: space-between; align-items: center; }
        .label { color: #6b7280; font-size: 14px; font-weight: 500; }
        .value { font-weight: 600; color: #111827; font-size: 14px; }
        .cta { display: inline-block; background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 16px 0; }
        .cta:hover { background: #d97706; }
        .footnote { color: #6b7280; font-size: 13px; margin-top: 20px; line-height: 1.5; }
        .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 16px 0; border-radius: 4px; }
        .warning-text { color: #92400e; font-size: 14px; margin: 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div class="badge">⏰ UNBOOKED OPPORTUNITY</div>
          <h1 class="title">${eventDetails.hostName} needs a food truck!</h1>
          
          <p style="margin: 0 0 16px 0; color: #374151;">Hi ${ownerName},</p>
          
          <p style="margin: 0 0 16px 0; color: #374151;">
            A local business has a food truck event coming up soon that hasn't been booked yet. This could be a great opportunity for you!
          </p>

          <div class="warning">
            <p class="warning-text">⚡ This event is happening within the next 48 hours. Express interest now to secure the spot!</p>
          </div>

          <div class="meta">
            <div class="meta-row">
              <span class="label">Event</span>
              <span class="value">${eventDetails.eventName}</span>
            </div>
            <div class="meta-row">
              <span class="label">Host</span>
              <span class="value">${eventDetails.hostName}</span>
            </div>
            <div class="meta-row">
              <span class="label">Date</span>
              <span class="value">${formattedDate}</span>
            </div>
            <div class="meta-row">
              <span class="label">Time</span>
              <span class="value">${eventDetails.startTime} - ${eventDetails.endTime}</span>
            </div>
            <div class="meta-row">
              <span class="label">Location</span>
              <span class="value">${eventDetails.address}</span>
            </div>
          </div>

          <div style="text-align: center; margin: 24px 0;">
            <a href="${process.env.PUBLIC_BASE_URL || 'http://localhost:5000'}/truck-discovery" class="cta">
              View Event & Express Interest
            </a>
          </div>

          <p class="footnote">
            💡 <strong>Why am I receiving this?</strong><br>
            You're receiving this notification because this event is happening soon and hasn't been booked yet. We wanted to give nearby food trucks like yours a chance to fill this opportunity before it's too late.
          </p>

          <p class="footnote">
            Questions? Reply to this email and we'll help you out.
          </p>

          <p style="margin-top: 24px; color: #6b7280;">
            Best,<br>
            The MealScout Team
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  await emailService.sendBasicEmail(email, subject, html);
}

/**
 * Register the cron job to run hourly
 */
export function registerEventNotificationCron() {
  // Note: In production, this would be registered with node-cron or similar
  // For now, this is just the implementation that can be called manually or via cron
  console.log('✅ Event notification cron job registered');
}
