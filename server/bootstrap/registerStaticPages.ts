/**
 * registerStaticPages.ts
 *
 * Registers compliance, legal, and SEO static page handlers.
 * Extracted from server/routes.ts as part of backend refactor Phase 1.
 *
 * Includes: /privacy-policy and /data-deletion.
 * SEO routes (robots/sitemaps) are registered in routes/seoRoutes.ts.
 */

import type { Express } from "express";

// ---------------------------------------------------------------------------
// Privacy Policy HTML
// ---------------------------------------------------------------------------

const PRIVACY_POLICY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - MealScout</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; }
    h1 { color: #dc2626; }
    h2 { color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    .section { margin: 20px 0; }
    ul, ol { margin: 10px 0; padding-left: 25px; }
    .highlight { background: #fef2f2; padding: 15px; border-left: 4px solid #dc2626; margin: 15px 0; }
    .contact { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p><strong>Last updated: January 13, 2025</strong></p>
  <p>How MealScout collects, uses, and protects your personal information.</p>
  <div class="section">
    <h2>1. Information We Collect</h2>
    <div class="highlight">
      <h3>Personal Information:</h3>
      <ul>
        <li>Name and email address (from account registration)</li>
        <li>Profile information from Google/Facebook OAuth</li>
        <li>Business information (for restaurant owners)</li>
        <li>Payment information (processed securely via Stripe)</li>
      </ul>
    </div>
    <div class="highlight">
      <h3>Location Data:</h3>
      <ul>
        <li>GPS coordinates for deal discovery</li>
        <li>Real-time location for food truck tracking</li>
        <li>Address information for business verification</li>
      </ul>
    </div>
  </div>
  <div class="section">
    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>Provide, maintain, and improve our Service</li>
      <li>Provide location-based deal recommendations</li>
      <li>Process subscription payments and billing</li>
      <li>Enable real-time food truck tracking</li>
      <li>Verify business credentials and documents</li>
      <li>Send important service communications and updates</li>
      <li>Monitor and analyze trends, usage, and activities</li>
      <li>Detect, investigate, and prevent fraudulent activities</li>
      <li>Personalize and improve your experience</li>
    </ul>
  </div>
  <div class="section">
    <h2>3. Information Sharing</h2>
    <ul>
      <li><strong>With Business Partners:</strong> General location data with restaurants</li>
      <li><strong>With Service Providers:</strong> Third-party payment processing and analytics</li>
      <li><strong>For Legal Requirements:</strong> When required by law or legal process</li>
      <li><strong>With Your Consent:</strong> When you explicitly agree</li>
      <li><strong>Aggregated Data:</strong> De-identified data that cannot be linked to individuals</li>
    </ul>
    <p><strong>We do not sell, trade, or rent your personal information to third parties.</strong></p>
  </div>
  <div class="section">
    <h2>4. Third-Party Services</h2>
    <ul>
      <li><strong>Google OAuth:</strong> For secure authentication</li>
      <li><strong>Facebook Login:</strong> For social authentication</li>
      <li><strong>Stripe:</strong> For secure payment processing</li>
      <li><strong>BigDataCloud:</strong> For location geocoding services</li>
    </ul>
  </div>
  <div class="section">
    <h2>5. Data Security</h2>
    <ul>
      <li>Encryption of data in transit and at rest</li>
      <li>Regular security assessments and updates</li>
      <li>Access controls and authentication requirements</li>
      <li>Secure payment processing through PCI-compliant providers</li>
      <li>Regular backups and disaster recovery procedures</li>
    </ul>
  </div>
  <div class="section">
    <h2>6. Your Rights</h2>
    <ul>
      <li>Access and update your personal information</li>
      <li>Delete your account and associated data</li>
      <li>Control location services through device settings</li>
      <li>Unsubscribe from marketing communications</li>
      <li>Request data portability (GDPR)</li>
      <li>Opt-out of data sale/sharing (CCPA)</li>
    </ul>
  </div>
  <div class="section">
    <h2>7. Data Retention</h2>
    <ul>
      <li><strong>Account Information:</strong> Until deletion, plus 30 days</li>
      <li><strong>Payment Information:</strong> As required by law (typically 7 years)</li>
      <li><strong>Location Data:</strong> Anonymized after 90 days</li>
      <li><strong>Analytics Data:</strong> Aggregated data may be retained indefinitely</li>
    </ul>
  </div>
  <div class="section">
    <h2>8. Contact Us</h2>
    <div class="contact">
      <p><strong>Email:</strong> <a href="mailto:support@mealscout.us">support@mealscout.us</a></p>
      <p><strong>Phone:</strong> <a href="tel:+19856626247">(985) 662-6247</a></p>
      <p>We will respond to your inquiry within 30 days.</p>
    </div>
  </div>
  <p style="margin-top:40px;padding-top:20px;border-top:2px solid #e5e7eb;color:#6b7280;">
    <small>This Privacy Policy is compliant with GDPR, CCPA/CPRA, and other major privacy regulations.</small>
  </p>
  <p style="text-align:center;margin-top:30px;">
    <a href="https://www.mealscout.us" style="color:#2563eb;text-decoration:none;">← Back to MealScout</a>
  </p>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Data Deletion HTML
// ---------------------------------------------------------------------------

const DATA_DELETION_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Data Deletion - MealScout</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; color: #333; }
    h1 { color: #dc2626; }
    h2 { color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    .section { margin: 20px 0; }
    ul, ol { margin: 10px 0; padding-left: 25px; }
    .highlight { background: #fef2f2; padding: 15px; border-left: 4px solid #dc2626; margin: 15px 0; }
    .contact { background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .warning { background: #fef3c7; padding: 10px; border-left: 4px solid #f59e0b; margin: 15px 0; }
  </style>
</head>
<body>
  <h1>Data Deletion Instructions</h1>
  <p><strong>Last updated: January 13, 2025</strong></p>
  <p>How to request deletion of your personal data from MealScout</p>
  <div class="section">
    <h2>Quick Account Deletion</h2>
    <div class="highlight">
      <h3>Self-Service Deletion:</h3>
      <ol>
        <li>Log into your MealScout account</li>
        <li>Navigate to Profile → Settings</li>
        <li>Scroll to "Account Management"</li>
        <li>Click "Delete Account"</li>
        <li>Confirm deletion by typing your email address</li>
      </ol>
      <p class="warning">⚠️ This action is permanent and cannot be undone.</p>
    </div>
  </div>
  <div class="section">
    <h2>Manual Deletion Request</h2>
    <div class="contact">
      <h3>Contact Information:</h3>
      <p><strong>Email:</strong> <a href="mailto:privacy@mealscout.us">privacy@mealscout.us</a></p>
      <p><strong>General Support:</strong> <a href="mailto:support@mealscout.us">support@mealscout.us</a></p>
      <p><strong>Subject Line:</strong> "Data Deletion Request"</p>
    </div>
  </div>
  <div class="section">
    <h2>What Gets Deleted</h2>
    <div class="highlight">
      <h3>Personal Data Removed:</h3>
      <ul>
        <li>Profile information and photos</li>
        <li>Email address and contact details</li>
        <li>Location data and preferences</li>
        <li>Order history and favorites</li>
        <li>Reviews and ratings</li>
        <li>Payment information</li>
        <li>Communication records</li>
      </ul>
    </div>
  </div>
  <div class="section">
    <h2>Deletion Timeline</h2>
    <div class="highlight">
      <ol>
        <li><strong>Immediate:</strong> Account access disabled</li>
        <li><strong>Within 7 days:</strong> Personal data removed from active systems</li>
        <li><strong>Within 30 days:</strong> Data purged from backups</li>
        <li><strong>Confirmation:</strong> Email notification when deletion is complete</li>
      </ol>
    </div>
  </div>
  <div class="section">
    <h2>Facebook Login Data</h2>
    <p>If you signed up using Facebook Login, deleting your MealScout account will remove all data MealScout obtained from Facebook and revoke access.</p>
  </div>
  <p style="margin-top:40px;padding-top:20px;border-top:2px solid #e5e7eb;color:#6b7280;">
    <small>This page complies with GDPR, CCPA, and other privacy regulations.</small>
  </p>
  <p style="text-align:center;margin-top:30px;">
    <a href="https://www.mealscout.us" style="color:#dc2626;text-decoration:none;">← Back to MealScout</a>
  </p>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Public registration entry point
// ---------------------------------------------------------------------------

export function registerStaticPages(app: Express): void {
  // Compliance pages
  app.get("/privacy-policy", (_req, res) => {
    console.log("🔍 Privacy policy route HIT");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(PRIVACY_POLICY_HTML);
  });

  app.get("/data-deletion", (_req, res) => {
    console.log("🔍 Data deletion route HIT");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(DATA_DELETION_HTML);
  });

  console.log("✅ Static compliance pages registered");
}
