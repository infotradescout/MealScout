const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

type OwnerProfileRecoveryCopyParams = {
  firstName?: string | null;
  actionUrl: string;
  needsVerification: boolean;
};

export function renderOwnerProfileRecoveryEmail({
  firstName,
  actionUrl,
  needsVerification,
}: OwnerProfileRecoveryCopyParams) {
  const safeName = escapeHtml(firstName || "there");
  const safeUrl = escapeHtml(actionUrl);
  const subject = needsVerification
    ? "Finish your MealScout truck profile"
    : "Finish your MealScout profile";
  const actionLabel = needsVerification
    ? "Verify and finish profile"
    : "Finish profile";
  const intro = needsVerification
    ? "Your MealScout account is started. Verify your email, then add your truck name, city, menu link, and profile details."
    : "Your MealScout account is started. Add your truck name, city, menu link, and profile details so customers can find you.";

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2>Hi ${safeName}, finish your MealScout profile</h2>
      <p>${escapeHtml(intro)}</p>
      <p style="margin: 16px 0;">
        <a href="${safeUrl}" style="background:#f59e0b;color:#111827;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:700;">
          ${escapeHtml(actionLabel)}
        </a>
      </p>
      <p>You can paste a link to an existing menu and MealScout will try to import it for you.</p>
      <p>Need help? Reply to this email with your truck name, city, and menu link.</p>
      <p style="color:#6b7280;font-size:12px;">The MealScout team</p>
    </div>
  `;

  const text = `Hi ${firstName || "there"}, ${intro} ${actionLabel}: ${actionUrl}. You can paste a link to an existing menu and MealScout will try to import it. Need help? Reply with your truck name, city, and menu link.`;

  return { subject, html, text };
}
