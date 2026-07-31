import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Calendar, Lock } from "lucide-react";
import { BackHeader } from "@/components/back-header";
import { SEOHead } from "@/components/seo-head";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title="Privacy Policy - MealScout | Data Protection & Privacy"
        description="Learn how MealScout collects, uses, and protects your personal information. Our privacy policy details data handling practices, security measures, and your privacy rights."
        keywords="privacy policy, data protection, privacy rights, data security, personal information"
        canonicalUrl="https://www.mealscout.us/privacy-policy"
      />
      <h1 className="sr-only">MealScout Privacy Policy</h1>
      <BackHeader
        title="Privacy Policy"
        fallbackHref="/"
        icon={Shield}
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
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                <Shield className="w-8 h-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-3xl font-bold text-[color:var(--text-primary)] mb-2">
              Privacy Policy
            </CardTitle>
            <p className="text-lg text-[color:var(--text-secondary)] max-w-2xl mx-auto">
              How MealScout collects, uses, and protects your personal
              information
            </p>
          </CardHeader>

          <CardContent className="prose prose-gray max-w-none">
            <div className="space-y-8">
              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  1. Information We Collect
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  We collect information you provide directly to us, information
                  we obtain automatically when you use our Service, and
                  information from third parties. The types of information we
                  may collect include:
                </p>

                <div className="bg-[var(--bg-surface)] p-4 rounded-lg mb-4">
                  <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                    Personal Information:
                  </h3>
                  <ul className="text-[color:var(--text-secondary)] space-y-1 text-sm">
                    <li>
                      - Name and email address (from account registration)
                    </li>
                    <li>- Profile information from Google/Facebook OAuth</li>
                    <li>- Business information (for restaurant owners)</li>
                    <li>
                      - Business compliance documents (permits, licenses,
                      insurance) if provided
                    </li>
                    <li>
                      - Payment information (processed securely via Stripe)
                    </li>
                  </ul>
                </div>

                <div className="bg-[var(--bg-surface)] p-4 rounded-lg">
                  <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                    Location Data:
                  </h3>
                  <ul className="text-[color:var(--text-secondary)] space-y-1 text-sm">
                    <li>- GPS coordinates for deal discovery</li>
                    <li>- Real-time location for food truck tracking</li>
                    <li>- Address information for business verification</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  2. How We Use Your Information
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  We use the information we collect for various purposes,
                  including to:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>Provide, maintain, and improve our Service</li>
                  <li>Provide location-based deal recommendations</li>
                  <li>Process orders, bookings, delivery charges, payouts, and other paid transactions</li>
                  <li>Enable real-time food truck tracking</li>
                  <li>Verify business credentials and documents</li>
                  <li>Send important service communications and updates</li>
                  <li>
                    Respond to your comments, questions, and customer service
                    requests
                  </li>
                  <li>
                    Monitor and analyze trends, usage, and activities in
                    connection with our Service
                  </li>
                  <li>
                    Detect, investigate, and prevent fraudulent activities
                  </li>
                  <li>Personalize and improve your experience</li>
                  <li>Comply with legal obligations and protect our rights</li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  MealScout may review compliance documents for verification
                  purposes only. We do not provide legal or regulatory advice,
                  and each host, truck, restaurant, or bar remains solely
                  responsible for its own licenses, permits, insurance, taxes,
                  and operational compliance.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  3. Information Sharing
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  We may share your information in the following situations:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>
                    <strong>With Business Partners:</strong> General location
                    data (city/region) with restaurants to help them understand
                    customer demographics
                  </li>
                  <li>
                    <strong>With Service Providers:</strong> Third-party
                    companies that perform services on our behalf, such as
                    payment processing and analytics
                  </li>
                  <li>
                    <strong>For Legal Requirements:</strong> When required by
                    law, legal process, or to protect our rights and safety
                  </li>
                  <li>
                    <strong>Business Transfers:</strong> In connection with any
                    merger, sale of assets, or acquisition of our business
                  </li>
                  <li>
                    <strong>With Your Consent:</strong> When you explicitly
                    agree to share information with third parties
                  </li>
                  <li>
                    <strong>Aggregated Data:</strong> De-identified, aggregated
                    data that cannot be linked back to individual users
                  </li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  We do not sell, trade, or rent your personal information to
                  third parties for their marketing purposes.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  4. Third-Party Services
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  Our Service integrates with third-party services that have
                  their own privacy policies. We encourage you to review their
                  privacy practices:
                </p>
                <div className="bg-[color:var(--accent-text)]/10 p-4 rounded-lg">
                  <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                    We use these third-party services:
                  </h3>
                  <ul className="text-[color:var(--text-secondary)] space-y-1 text-sm">
                    <li>
                      - <strong>Google OAuth:</strong> For secure authentication
                    </li>
                    <li>
                      - <strong>Facebook Login:</strong> For social
                      authentication
                    </li>
                    <li>
                      - <strong>Stripe:</strong> For secure payment processing
                    </li>
                    <li>
                      - <strong>BigDataCloud:</strong> For location geocoding
                      services
                    </li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  5. Data Security
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  We implement appropriate technical and organizational measures
                  to protect your personal information against unauthorized
                  access, alteration, disclosure, or destruction. These measures
                  include:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>Encryption of data in transit and at rest</li>
                  <li>Regular security assessments and updates</li>
                  <li>Access controls and authentication requirements</li>
                  <li>
                    Secure payment processing through PCI-compliant providers
                  </li>
                  <li>Regular backups and disaster recovery procedures</li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  However, no method of transmission over the Internet or
                  electronic storage is 100% secure. We cannot guarantee
                  absolute security but are committed to protecting your
                  information using industry-standard practices.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  6. Location Data and GPS Tracking
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  Location data is essential to our Service's functionality.
                  Here's how we handle location information:
                </p>
                <div className="bg-[color:var(--accent-text)]/10 p-4 rounded-lg mb-4">
                  <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                    Collection:
                  </h3>
                  <ul className="text-[color:var(--text-secondary)] space-y-1 text-sm">
                    <li>
                      - GPS coordinates when you use location-based features
                    </li>
                    <li>
                      - Real-time location for food truck operators during
                      business hours
                    </li>
                    <li>
                      - Address information you provide for business
                      verification
                    </li>
                  </ul>
                </div>
                <div className="bg-[color:var(--accent-text)]/10 p-4 rounded-lg mb-4">
                  <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                    Usage:
                  </h3>
                  <ul className="text-[color:var(--text-secondary)] space-y-1 text-sm">
                    <li>- Show nearby deals and restaurants</li>
                    <li>- Enable food truck tracking for customers</li>
                    <li>
                      - Improve recommendations based on location patterns
                    </li>
                    <li>
                      - Analytics for business users (aggregated and anonymized)
                    </li>
                  </ul>
                </div>
                <p className="text-[color:var(--text-secondary)] leading-relaxed">
                  You can control location sharing through your device settings.
                  Disabling location services may limit some features of our
                  Service.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  7. Your Rights and Choices
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  Depending on your location, you may have certain rights
                  regarding your personal information:
                </p>
                <div className="space-y-4">
                  <div className="bg-[var(--bg-surface)] p-4 rounded-lg">
                    <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                      All Users:
                    </h3>
                    <ul className="text-[color:var(--text-secondary)] space-y-1 text-sm">
                      <li>
                        - Access and update your personal information through
                        account settings
                      </li>
                      <li>- Delete your account and associated data</li>
                      <li>
                        - Control location services through device settings
                      </li>
                      <li>- Unsubscribe from marketing communications</li>
                    </ul>
                  </div>
                  <div className="bg-[var(--bg-surface)] p-4 rounded-lg">
                    <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                      EU/UK Users (GDPR Rights):
                    </h3>
                    <ul className="text-[color:var(--text-secondary)] space-y-1 text-sm">
                      <li>- Right to access your personal data</li>
                      <li>
                        - Right to rectification (correction) of inaccurate data
                      </li>
                      <li>- Right to erasure ("right to be forgotten")</li>
                      <li>- Right to restrict or object to processing</li>
                      <li>- Right to data portability</li>
                      <li>- Right to withdraw consent</li>
                    </ul>
                  </div>
                  <div className="bg-[var(--bg-surface)] p-4 rounded-lg">
                    <h3 className="font-semibold text-[color:var(--text-primary)] mb-2">
                      California Users (CCPA/CPRA Rights):
                    </h3>
                    <ul className="text-[color:var(--text-secondary)] space-y-1 text-sm">
                      <li>
                        - Right to know what personal information we collect and
                        how it's used
                      </li>
                      <li>- Right to delete personal information</li>
                      <li>
                        - Right to correct inaccurate personal information
                      </li>
                      <li>
                        - Right to opt-out of the sale/sharing of personal
                        information
                      </li>
                      <li>
                        - Right to non-discrimination for exercising these
                        rights
                      </li>
                    </ul>
                  </div>
                </div>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  To exercise these rights, contact us at privacy@mealscout.us.
                  We will respond within the timeframe required by applicable
                  law.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  8. Data Retention
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  We retain personal information for as long as necessary to
                  provide our Service and fulfill the purposes outlined in this
                  Privacy Policy, unless a longer retention period is required
                  by law. Specific retention periods include:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>
                    <strong>Account Information:</strong> Until account
                    deletion, plus 30 days for fraud prevention
                  </li>
                  <li>
                    <strong>Payment Information:</strong> As required by payment
                    processors and tax regulations (typically 7 years)
                  </li>
                  <li>
                    <strong>Location Data:</strong> Anonymized after 90 days,
                    deleted entirely after 2 years
                  </li>
                  <li>
                    <strong>Business Verification Documents:</strong> 7 years
                    for regulatory compliance
                  </li>
                  <li>
                    <strong>Communications:</strong> Customer service records
                    kept for 3 years
                  </li>
                  <li>
                    <strong>Analytics Data:</strong> Aggregated and anonymized
                    data may be retained indefinitely
                  </li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  When you delete your account, we will delete or anonymize your
                  personal information within 30 days, except where retention is
                  required by law.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  9. International Data Transfers
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  MealScout operates primarily in the United States. If you are
                  accessing our Service from outside the US, your information
                  may be transferred to, stored, and processed in the United
                  States and other countries where our service providers
                  operate.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  For EU and UK users, we ensure appropriate safeguards are in
                  place for international transfers, including:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>
                    Standard Contractual Clauses approved by the European
                    Commission
                  </li>
                  <li>
                    Adequacy decisions for transfers to countries with adequate
                    protection
                  </li>
                  <li>
                    Binding corporate rules and certification mechanisms where
                    applicable
                  </li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  10. Children's Privacy
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  Our Service is not intended for children under 13 years of
                  age. We do not knowingly collect personal information from
                  children under 13. If you are a parent or guardian and believe
                  your child has provided us with personal information, please
                  contact us immediately.
                </p>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  If we discover that a child under 13 has provided us with
                  personal information, we will take steps to delete such
                  information from our files as quickly as possible.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  11. Changes to This Policy
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  We may update this Privacy Policy from time to time to reflect
                  changes in our practices, technology, legal requirements, or
                  other factors. When we make material changes, we will:
                </p>
                <ul className="list-disc list-inside text-[color:var(--text-secondary)] space-y-2 ml-4">
                  <li>
                    Update the "Last updated" date at the top of this policy
                  </li>
                  <li>Provide notice through our Service or via email</li>
                  <li>
                    For material changes, provide additional notice as required
                    by law
                  </li>
                  <li>
                    In some cases, seek your consent before implementing changes
                  </li>
                </ul>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mt-4">
                  We encourage you to review this Privacy Policy periodically.
                  Your continued use of our Service after changes are posted
                  constitutes acceptance of the updated policy.
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)] mb-4">
                  12. Contact Us
                </h2>
                <p className="text-[color:var(--text-secondary)] leading-relaxed mb-4">
                  If you have questions, concerns, or requests regarding this
                  Privacy Policy or our data practices, please contact us:
                </p>
                <div className="bg-[var(--bg-surface)] p-4 rounded-lg mb-4">
                  <p className="text-[color:var(--text-secondary)]">
                    <strong>Privacy Officer:</strong>{" "}
                    <a
                      href="mailto:privacy@mealscout.us"
                      className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text)] underline"
                    >
                      privacy@mealscout.us
                    </a>
                  </p>
                  <p className="text-[color:var(--text-secondary)]">
                    <strong>General Inquiries:</strong>{" "}
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
                <p className="text-[color:var(--text-secondary)] leading-relaxed">
                  We will respond to your inquiry within 30 days. For urgent
                  privacy concerns, please mark your email as "Urgent - Privacy
                  Request" in the subject line.
                </p>
              </section>
            </div>

            {/* Privacy Notice */}
            <div className="mt-12 p-6 bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-lg">
              <div className="flex items-start space-x-3">
                <Lock className="w-5 h-5 text-[color:var(--status-success)] mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-semibold text-[color:var(--status-success)] mb-1">
                    Privacy Commitment
                  </h3>
                  <p className="text-[color:var(--status-success)] text-sm">
                    This Privacy Policy is compliant with GDPR, CCPA/CPRA, and
                    other major privacy regulations. We are committed to
                    protecting your privacy and being transparent about our data
                    practices.
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
