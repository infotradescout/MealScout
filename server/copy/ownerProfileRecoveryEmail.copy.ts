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
  userType?: string | null;
  recoveryReason?: "no_business" | "no_menu_items" | "complete_public_profile";
  missingLabels?: string[];
};

type OwnerProfilePromptCopyParams = {
  userType?: string | null;
  recoveryReason: "no_business" | "no_menu_items" | "complete_public_profile";
};

const audienceLabel = (userType?: string | null) =>
  String(userType || "") === "food_truck" ? "truck" : "business";

export function buildOwnerProfileRecoveryPromptCopy({
  userType,
  recoveryReason,
}: OwnerProfilePromptCopyParams) {
  const business = audienceLabel(userType);

  if (recoveryReason === "no_business") {
    return {
      title: `Finish your MealScout ${business} profile`,
      message:
        "A complete profile is the quickest way to start getting real views. Add the basics so people can find you, share you, and know what you serve.",
      cta: "Finish profile",
    };
  }

  if (recoveryReason === "no_menu_items") {
    return {
      title: "Add your menu",
      message:
        "Your profile is started. Adding menu items gives customers something real to view right away and helps your page work harder for your business.",
      cta: "Add menu",
    };
  }

  return {
    title: "Make your profile easier to choose",
    message:
      "A few more public details can help people trust your listing faster and get you the best MealScout experience possible.",
    cta: "Add details",
  };
}

export function renderOwnerProfileRecoveryEmail({
  firstName,
  actionUrl,
  needsVerification,
  userType,
  recoveryReason = "no_business",
  missingLabels = [],
}: OwnerProfileRecoveryCopyParams) {
  const prompt = buildOwnerProfileRecoveryPromptCopy({
    userType,
    recoveryReason,
  });
  const safeName = escapeHtml(firstName || "there");
  const safeUrl = escapeHtml(actionUrl);
  const subject = needsVerification
    ? "A quick next step for your MealScout profile"
    : prompt.title;
  const actionLabel = needsVerification ? "Verify and continue" : prompt.cta;
  const intro = needsVerification
    ? "Your MealScout account is started. Verify your email, then finish the profile so people have something real to view and share."
    : prompt.message;
  const missing =
    missingLabels.length > 0
      ? `Next up: ${missingLabels.map(escapeHtml).join(", ")}.`
      : "";

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2>Hi ${safeName}, ${escapeHtml(prompt.title)}</h2>
      <p>${escapeHtml(intro)}</p>
      ${missing ? `<p>${missing}</p>` : ""}
      <p style="margin: 16px 0;">
        <a href="${safeUrl}" style="background:#f59e0b;color:#111827;text-decoration:none;padding:12px 18px;border-radius:8px;display:inline-block;font-weight:700;">
          ${escapeHtml(actionLabel)}
        </a>
      </p>
      <p>Friendly reminder: we keep these light, at most once a day while key setup details are still missing.</p>
      <p>You can paste a link to an existing menu and MealScout will try to import it for you.</p>
      <p>Need help? Reply with your business name, city, and menu link.</p>
      <p style="color:#6b7280;font-size:12px;">The MealScout team</p>
    </div>
  `;

  const text = `Hi ${firstName || "there"}, ${intro} ${missing ? `${missing} ` : ""}${actionLabel}: ${actionUrl}. Friendly reminder: we keep these light, at most once a day while key setup details are still missing. Need help? Reply with your business name, city, and menu link.`;

  return { subject, html, text };
}
