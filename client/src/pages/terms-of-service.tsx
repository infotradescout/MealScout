import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Calendar, Shield } from "lucide-react";
import { BackHeader } from "@/components/back-header";
import { SEOHead } from "@/components/seo-head";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title="Terms of Service - MealScout | User Agreement"
        description="Read MealScout's Terms of Service. Understand the rules, regulations, and user agreement for using our food deals platform. Last updated January 2025."
        keywords="terms of service, user agreement, terms and conditions, legal terms, platform rules"
        canonicalUrl="https://www.mealscout.us/terms-of-service"
      />
      <h1 className="sr-only">MealScout Terms of Service</h1>
      <BackHeader
        title="Terms of Service"
        fallbackHref="/"
        icon={FileText}
        rightActions={
          <div className="flex items-center space-x-2 text-sm text-[color:var(--text-secondary)]">
            <Calendar className="w-4 h-4" />
            <span>Last updated: January 13, 2025</span>
          </div>
        }
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
          <CardHeader className="text-center pb-8">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center">
                <FileText className="w-8 h-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-3xl font-bold text-[color:var(--text-primary)] mb-2">
              Terms of Service
            </CardTitle>
            <p className="text-lg text-[color:var(--text-secondary)] max-w-2xl mx-auto">
              Please read these Terms of Service carefully before using
              MealScout
            </p>
          </CardHeader>

          <CardContent className="prose prose-gray max-w-none">
            <div className="space-y-8">
              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  1. Acceptance of Terms
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  By accessing and using MealScout ("Service"), you accept and
                  agree to be bound by the terms and provision of this agreement
                  ("Terms"). If you do not agree to these Terms, please do not
                  use our Service. These Terms apply to all visitors, users, and
                  others who access or use the Service.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  MealScout is operated by MealScout ("Company," "we," "us," or
                  "our"). By using our Service, you agree to these Terms and our
                  Privacy Policy.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  2. Description of Service
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  MealScout is a hyper-local meal deals discovery platform that
                  connects restaurants, bars, and food trucks with nearby
                  customers through location-based services and real-time deal
                  notifications. Our Service provides:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>Deal creation and management tools for businesses</li>
                  <li>Location-based deal discovery for customers</li>
                  <li>Real-time GPS tracking for food trucks</li>
                  <li>Business verification and authentication services</li>
                  <li>User review and rating systems</li>
                  <li>
                    Subscription-based business model with various pricing tiers
                  </li>
                  <li>Analytics and reporting for business users</li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  The Service is provided on a Software-as-a-Service (SaaS)
                  basis and requires an active subscription for business users
                  to access premium features.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  3. Subscription Terms
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  Business users must maintain an active subscription to access
                  premium features. Subscriptions automatically renew unless
                  cancelled before the renewal date. You may cancel your
                  subscription at any time through your account settings.
                </p>
                <div className="bg-[var(--bg-surface)] p-4 rounded-lg mb-4">
                  <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                    Pricing Plans:
                  </h3>
                  <ul className="text-[color:var(--text-secondary)] space-y-1">
                    <li>- Monthly: $25/month (was $50)</li>
                    <li>- Quarterly: $100/3 months (first-time users only)</li>
                  </ul>
                </div>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  <strong>Auto-Renewal:</strong> Subscriptions automatically
                  renew for the same period unless cancelled. You will be
                  charged the then-current subscription fee.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  <strong>Promo Codes:</strong> We may offer promotional codes
                  that provide discounts or free access. Promo codes are subject
                  to terms and conditions and may be revoked at any time.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed">
                  <strong>Refunds:</strong> Subscription fees are generally
                  non-refundable. However, we may provide refunds at our sole
                  discretion for certain circumstances.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  4. User Conduct
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  You agree to use MealScout only for lawful purposes and in
                  accordance with these Terms. You agree not to use the Service:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>
                    To violate any applicable laws, regulations, or third-party
                    rights
                  </li>
                  <li>
                    To post false, misleading, or fraudulent deals or business
                    information
                  </li>
                  <li>
                    To impersonate another person or entity or misrepresent your
                    affiliation
                  </li>
                  <li>
                    To interfere with or disrupt the Service or servers
                    connected to the Service
                  </li>
                  <li>
                    To attempt to gain unauthorized access to any part of the
                    Service
                  </li>
                  <li>
                    To harvest or collect information about other users without
                    their consent
                  </li>
                  <li>
                    To post content that is defamatory, obscene, or violates
                    intellectual property rights
                  </li>
                  <li>
                    To use automated systems or software to extract data from
                    the Service
                  </li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  We reserve the right to suspend or terminate accounts that
                  violate these conduct rules.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  5. Location Services
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  MealScout uses location services to provide relevant deals and
                  track food truck locations. By using our Service, you consent
                  to:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>
                    Collection of your device's location data when using the app
                  </li>
                  <li>
                    Real-time location sharing for food truck operators during
                    business hours
                  </li>
                  <li>
                    Storage of location history to improve service
                    recommendations
                  </li>
                  <li>
                    Sharing of general location data (city/region) with
                    restaurant partners
                  </li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  You can disable location services in your device settings, but
                  this may limit the functionality of our Service. Location data
                  is handled in accordance with our Privacy Policy.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  6. Business Verification
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  Business users must provide accurate information and may be
                  required to verify their business through:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>Valid business license or permit documentation</li>
                  <li>
                    Tax identification numbers or business registration
                    documents
                  </li>
                  <li>Proof of business address and operation</li>
                  <li>
                    Food service permits and health department certifications
                    (where applicable)
                  </li>
                  <li>
                    Identity verification for authorized business
                    representatives
                  </li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  We reserve the right to suspend accounts pending verification
                  and may request additional documentation at any time.
                  Providing false information may result in immediate account
                  termination.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  <strong>Compliance responsibility:</strong> Hosts, food
                  trucks, restaurants, and bars are solely responsible for
                  obtaining and maintaining all required local, state, and
                  federal licenses, permits, inspections, health approvals,
                  zoning approvals, and insurance coverage. MealScout does not
                  verify legal compliance beyond the documents we request, does
                  not provide legal or compliance advice, and is not responsible
                  for your operations.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  7. Payment Terms
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  All payments are processed securely through Stripe, Inc. By
                  providing payment information, you represent that you are
                  authorized to use the payment method and authorize us to
                  charge your payment method.
                </p>
                <div className="bg-[var(--bg-surface)] p-4 rounded-lg mb-4">
                  <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                    Payment Processing:
                  </h3>
                  <ul className="text-[color:var(--text-secondary)] space-y-1 text-sm">
                    <li>- All payments are processed in USD</li>
                    <li>
                      - Subscription fees are charged at the beginning of each
                      billing period
                    </li>
                    <li>- Failed payments may result in service suspension</li>
                    <li>
                      - You are responsible for any taxes or fees imposed by
                      your jurisdiction
                    </li>
                  </ul>
                </div>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  <strong>Billing Disputes:</strong> Contact us within 30 days
                  of any billing dispute. We will investigate and resolve
                  disputes in good faith.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed">
                  <strong>Price Changes:</strong> We may change subscription
                  prices with 30 days advance notice. Continued use after price
                  changes constitutes acceptance.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  8. Termination
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  Either party may terminate this agreement at any time. You may
                  cancel your account through the Service settings or by
                  contacting us. We may suspend or terminate your account
                  immediately if:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>You violate these Terms or our policies</li>
                  <li>Your account is inactive for an extended period</li>
                  <li>
                    We reasonably believe your account poses a security risk
                  </li>
                  <li>Required by law or legal process</li>
                  <li>
                    Payment failure after reasonable notice and opportunity to
                    cure
                  </li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  Upon termination, your right to use the Service will cease
                  immediately. We may delete your account data after a
                  reasonable period, subject to legal requirements and our
                  Privacy Policy.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  9. Limitation of Liability
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY
                  KIND. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL
                  WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY,
                  FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  IN NO EVENT SHALL MEALSCOUT BE LIABLE FOR ANY INDIRECT,
                  INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES,
                  INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, OR
                  BUSINESS INTERRUPTION, ARISING FROM YOUR USE OF THE SERVICE.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  MealScout is a marketplace platform only. Hosts and trucks
                  contract directly with each other and are fully responsible
                  for their own operations, staffing, safety, food handling,
                  permits, insurance, taxes, and legal compliance. MealScout is
                  not a party to any on-site arrangement and assumes no
                  liability for performance, accidents, injuries, property
                  damage, regulatory violations, or disputes.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING FROM THE
                  SERVICE SHALL NOT EXCEED THE AMOUNT YOU PAID TO US IN THE
                  TWELVE (12) MONTHS PRECEDING THE CLAIM.
                </p>
                <div className="bg-yellow-50 p-4 rounded-lg mt-4">
                  <p className="text-yellow-800 text-sm">
                    <strong>Important:</strong> MealScout is a platform that
                    connects businesses and customers. We are not responsible
                    for the quality, safety, or accuracy of deals, food, or
                    services provided by third-party businesses.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  10. Governing Law and Disputes
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  These Terms are governed by the laws of the United States
                  without regard to conflict of law principles. Any disputes
                  arising from these Terms or the Service will be resolved
                  through binding arbitration, except that either party may seek
                  injunctive relief in court.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  If any provision of these Terms is found unenforceable, the
                  remaining provisions will remain in full force and effect.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  11. Changes to Terms
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  We may update these Terms from time to time. We will notify
                  you of material changes by posting the updated Terms on our
                  Service and updating the "Last updated" date. Your continued
                  use of the Service after changes constitutes acceptance of the
                  new Terms.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  12. Contact Information
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  For questions about these Terms, please contact us at:
                </p>
                <div className="bg-[var(--bg-surface)] p-4 rounded-lg">
                  <p className="text-[color:var(--text-secondary)]">
                    <strong>Email:</strong>{" "}
                    <a
                      href="mailto:support@mealscout.us"
                      className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text)] underline"
                    >
                      support@mealscout.us
                    </a>
                  </p>
                  <p className="text-[color:var(--text-secondary)]">
                    <strong>Phone:</strong>{" "}
                    <a
                      href="tel:+19856626247"
                      className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text)] underline"
                    >
                      (985) 662-6247
                    </a>
                  </p>
                </div>
              </section>
            </div>

            {/* Legal Notice */}
            <div className="mt-12 p-6 bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-lg">
              <div className="flex items-start space-x-3">
                <Shield className="w-5 h-5 text-[color:var(--status-success)] mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-[color:var(--status-success)] mb-1">
                    Legal Notice
                  </h3>
                  <p className="text-[color:var(--status-success)] text-sm">
                    These Terms of Service are effective as of the date listed
                    above. Please review them carefully and contact us if you
                    have any questions.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
