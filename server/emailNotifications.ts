import { LocationRequest } from '@shared/schema';
import { emailService } from './emailService';
import { storage } from './storage';

/**
 * Send Golden Fork award notification email
 */
export async function sendGoldenForkAwardEmail(userId: string) {
  const user = await storage.getUser(userId);
  if (!user || !user.email) return;

  const subject = '🍴 Congratulations! You\'ve Earned the Golden Fork Award!';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #f59e0b 0%, #eab308 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .badge { font-size: 48px; margin-bottom: 10px; }
        .content { background: #fff; padding: 30px; border: 2px solid #f59e0b; border-top: none; border-radius: 0 0 10px 10px; }
        .stats { background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .stat-item { margin: 10px 0; }
        .stat-label { font-weight: bold; color: #92400e; }
        .cta { background: #f59e0b; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0; }
        .benefits { list-style: none; padding: 0; }
        .benefits li { padding: 10px 0; border-bottom: 1px solid #fef3c7; }
        .benefits li:before { content: "✓ "; color: #f59e0b; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="badge">🍴</div>
          <h1>Golden Fork Award!</h1>
          <p>You're Now an Official MealScout Food Reviewer</p>
        </div>
        <div class="content">
          <p>Hi ${user.firstName || 'Food Lover'},</p>
          
          <p>We're thrilled to announce that you've earned the prestigious <strong>Golden Fork Award</strong>! Your passion for discovering and reviewing great food has made you an influential member of the MealScout community.</p>
          
          <div class="stats">
            <h3 style="margin-top: 0; color: #92400e;">Your Achievement Stats:</h3>
            <div class="stat-item">
              <span class="stat-label">Reviews Written:</span> ${user.reviewCount || 0}
            </div>
            <div class="stat-item">
              <span class="stat-label">Recommendations Made:</span> ${user.recommendationCount || 0}
            </div>
            <div class="stat-item">
              <span class="stat-label">Influence Score:</span> ${user.influenceScore || 0}
            </div>
          </div>

          <h3>Golden Fork Benefits:</h3>
          <ul class="benefits">
            <li>Your reviews and recommendations appear first in listings</li>
            <li>Special Golden Fork badge on your profile</li>
            <li>Increased visibility in the MealScout community</li>
            <li>Early access to new features</li>
            <li>Priority customer support</li>
          </ul>

          <p style="text-align: center;">
            <a href="${process.env.PUBLIC_BASE_URL}/profile" class="cta">View Your Profile</a>
          </p>

          <p>Keep sharing your culinary adventures and helping others discover amazing food!</p>

          <p>Cheers,<br>The MealScout Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await emailService.sendBasicEmail(user.email, subject, html);
}

/**
 * Send Golden Plate award notification email to restaurant owner
 */
export async function sendGoldenPlateAwardEmail(restaurantId: string) {
  const restaurant = await storage.getRestaurant(restaurantId);
  if (!restaurant) return;

  const owner = await storage.getUser(restaurant.ownerId);
  if (!owner || !owner.email) return;

  const subject = '🏆 Congratulations! Your Restaurant Won the Golden Plate Award!';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #d97706 0%, #f59e0b 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .badge { font-size: 48px; margin-bottom: 10px; }
        .content { background: #fff; padding: 30px; border: 2px solid #d97706; border-top: none; border-radius: 0 0 10px 10px; }
        .stats { background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .stat-item { margin: 10px 0; }
        .stat-label { font-weight: bold; color: #92400e; }
        .cta { background: #d97706; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0; }
        .benefits { list-style: none; padding: 0; }
        .benefits li { padding: 10px 0; border-bottom: 1px solid #fef3c7; }
        .benefits li:before { content: "★ "; color: #d97706; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="badge">🏆</div>
          <h1>Golden Plate Award Winner!</h1>
          <p>Top Restaurant in Your Area</p>
        </div>
        <div class="content">
          <p>Dear ${owner.firstName || 'Restaurant Owner'},</p>
          
          <p>Congratulations! <strong>${restaurant.name}</strong> has been awarded the prestigious <strong>Golden Plate Award</strong> for this quarter!</p>
          
          <p>Your restaurant has been recognized as one of the top-performing establishments in your area based on customer recommendations, favorites, reviews, and overall excellence.</p>
          
          <div class="stats">
            <h3 style="margin-top: 0; color: #92400e;">Your Achievement:</h3>
            <div class="stat-item">
              <span class="stat-label">Ranking Score:</span> ${restaurant.rankingScore || 0}
            </div>
            <div class="stat-item">
              <span class="stat-label">Total Golden Plates:</span> ${restaurant.goldenPlateCount || 1}
            </div>
            <div class="stat-item">
              <span class="stat-label">Award Date:</span> ${new Date().toLocaleDateString()}
            </div>
          </div>

          <h3>Golden Plate Benefits:</h3>
          <ul class="benefits">
            <li>Your restaurant appears first in local search results</li>
            <li>Featured on the Golden Plate Winners showcase page</li>
            <li>Golden Plate badge displayed on your profile</li>
            <li>This award is permanent and stays with you forever</li>
            <li>Increased visibility to thousands of food lovers</li>
            <li>Marketing materials to promote your award</li>
          </ul>

          <p style="text-align: center;">
            <a href="${process.env.PUBLIC_BASE_URL}/restaurant-owner-dashboard" class="cta">View Your Dashboard</a>
          </p>

          <p>Thank you for your commitment to excellence. Keep up the amazing work!</p>

          <p>Best regards,<br>The MealScout Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await emailService.sendBasicEmail(owner.email, subject, html);
}

/**
 * Send deal claimed notification to restaurant owner
 */
export async function sendDealClaimedNotification(dealId: string, userId: string) {
  const deal = await storage.getDeal(dealId);
  if (!deal) return;

  const restaurant = await storage.getRestaurant(deal.restaurantId);
  if (!restaurant) return;

  const owner = await storage.getUser(restaurant.ownerId);
  const customer = await storage.getUser(userId);
  if (!owner || !owner.email) return;

  const subject = `🎉 New Deal Claimed: ${deal.title}`;
  const discountLabel = deal.discountValue
    ? deal.dealType === "fixed"
      ? `$${deal.discountValue} off`
      : `${deal.discountValue}% off`
    : "Limited Time";
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #fff; padding: 20px; border: 1px solid #d1d5db; border-top: none; border-radius: 0 0 8px 8px; }
        .deal-info { background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .cta { background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2 style="margin: 0;">New Deal Claimed! 🎉</h2>
        </div>
        <div class="content">
          <p>Hi ${owner.firstName || 'Restaurant Owner'},</p>
          
          <p>Great news! A customer just claimed one of your deals:</p>
          
          <div class="deal-info">
            <h3 style="margin-top: 0;">${deal.title}</h3>
            <p><strong>Deal:</strong> ${discountLabel}</p>
            <p><strong>Customer:</strong> ${customer?.firstName || 'Customer'} ${customer?.lastName || ''}</p>
            <p><strong>Claimed:</strong> ${new Date().toLocaleString()}</p>
          </div>

          <p>Make sure to provide excellent service when this customer visits!</p>

          <p style="text-align: center;">
            <a href="${process.env.PUBLIC_BASE_URL}/restaurant-owner-dashboard" class="cta">View All Claims</a>
          </p>

          <p>Best,<br>MealScout</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await emailService.sendBasicEmail(owner.email, subject, html);
}

/**
 * Send welcome email to new users
 */
export async function sendWelcomeEmail(userId: string) {
  const user = await storage.getUser(userId);
  if (!user || !user.email) return;

  const subject = 'Welcome to MealScout! 🍽️';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ef4444 0%, #f97316 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
        .features { display: grid; gap: 15px; margin: 20px 0; }
        .feature { background: #fef2f2; padding: 15px; border-radius: 8px; border-left: 4px solid #ef4444; }
        .cta { background: #ef4444; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0;">Welcome to MealScout! 🍽️</h1>
          <p style="margin: 10px 0 0 0;">Discover Amazing Food Deals Near You</p>
        </div>
        <div class="content">
          <p>Hi ${user.firstName || 'Food Lover'},</p>
          
          <p>Welcome to MealScout! We're excited to have you join our community of food enthusiasts.</p>

          <div class="features">
            <div class="feature">
              <strong>🔍 Discover Deals</strong><br>
              Find exclusive deals and discounts at local restaurants
            </div>
            <div class="feature">
              <strong>⭐ Write Reviews</strong><br>
              Share your experiences and earn the Golden Fork award
            </div>
            <div class="feature">
              <strong>❤️ Save Favorites</strong><br>
              Keep track of your favorite restaurants and get notified of new deals
            </div>
            <div class="feature">
              <strong>🚚 Track Food Trucks</strong><br>
              See real-time locations of food trucks in your area
            </div>
          </div>

          <p style="text-align: center;">
            <a href="${process.env.PUBLIC_BASE_URL}" class="cta">Start Exploring Deals</a>
          </p>

          <p>If you have any questions, just reply to this email!</p>

          <p>Happy eating!<br>The MealScout Team</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await emailService.sendBasicEmail(user.email, subject, html);
}

export async function sendTruckInterestNotification(locationRequest: LocationRequest, restaurantId: string, message?: string) {
  const host = await storage.getUser(locationRequest.postedByUserId);
  if (!host?.email) return;

  const restaurant = await storage.getRestaurant(restaurantId);
  if (!restaurant) return;

  const owner = await storage.getUser(restaurant.ownerId);

  const subject = `${restaurant.name} wants to bring their truck to ${locationRequest.businessName}`;
  const preferredDates = Array.isArray(locationRequest.preferredDates)
    ? locationRequest.preferredDates.join(', ')
    : '';

  const hostMessage = message?.trim() ? `<p style="background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e5e7eb;"><strong>Message from the truck:</strong><br>${message.trim()}</p>` : '';

  const contactLine = owner?.email
    ? `<p style="margin:12px 0 0 0;"><strong>Contact:</strong> ${owner.email}</p>`
    : '';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #111827; }
        .container { max-width: 640px; margin: 0 auto; padding: 20px; }
        .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; background: #ffffff; }
        .badge { display: inline-block; background: #fee2e2; color: #b91c1c; padding: 6px 10px; border-radius: 9999px; font-weight: 600; font-size: 12px; }
        .meta { display: grid; gap: 8px; margin: 16px 0; }
        .meta div { display: flex; justify-content: space-between; }
        .label { color: #6b7280; font-size: 14px; }
        .value { font-weight: 600; color: #111827; }
        .footnote { color: #6b7280; font-size: 12px; margin-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="badge">New truck interest</span>
          </div>
          <h2 style="margin:16px 0 8px 0;">${restaurant.name} wants to park at ${locationRequest.businessName}</h2>
          <p style="margin:0 0 12px 0;">You received this because you posted a spot for food trucks on MealScout.</p>

          <div class="meta">
            <div><span class="label">Location type</span><span class="value">${locationRequest.locationType}</span></div>
            <div><span class="label">Address</span><span class="value">${locationRequest.address}</span></div>
            <div><span class="label">Preferred dates</span><span class="value">${preferredDates || 'No dates specified'}</span></div>
            <div><span class="label">Expected foot traffic</span><span class="value">${locationRequest.expectedFootTraffic}</span></div>
          </div>

          ${hostMessage}
          <p style="margin:12px 0 0 0;"><strong>Truck:</strong> ${restaurant.name}</p>
          ${contactLine}

          <p class="footnote">MealScout does not broker or guarantee bookings. Coordinate directly with the truck to confirm details.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await emailService.sendBasicEmail(host.email, subject, html);
}
