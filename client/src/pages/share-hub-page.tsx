import ShareHub from "@/components/share-hub";
import { BackHeader } from "@/components/back-header";
import { useAuth } from "@/hooks/useAuth";

export default function ShareHubPage() {
  const { user, isAuthenticated } = useAuth();
  const userType = String(user?.userType || "");

  const mode =
    userType === "admin" || userType === "super_admin"
      ? "admin"
      : userType === "staff"
        ? "staff"
        : "user";

  const description =
    mode === "user"
      ? "Copy a link, send a text, or share MealScout in one tap."
      : "Fast links and messages for outreach, referrals, and launch ops.";

  return (
    <div className="min-h-screen pb-28">
      <BackHeader title="Share" fallbackHref="/" />
      <main className="mx-auto w-full max-w-5xl px-4 py-5">
        <ShareHub
          mode={mode}
          title="Share MealScout"
          description={description}
          enableAffiliateLookup={isAuthenticated}
        />
      </main>
    </div>
  );
}
