import ShareHub from "@/components/share-hub";
import { BackHeader } from "@/components/back-header";
import { useAuth } from "@/hooks/useAuth";

export default function ShareHubPage() {
  const { user } = useAuth();
  const userType = String(user?.userType || "");

  const mode =
    userType === "admin" || userType === "super_admin"
      ? "admin"
      : userType === "staff"
        ? "staff"
        : "user";

  const description =
    mode === "user"
      ? "Pick the kind of MealScout link you want to send. Each card has a ready-to-copy link and a plain-language message."
      : "Share directory for growth ops, outreach, referrals, and internal tools.";

  return (
    <div className="min-h-screen pb-28">
      <BackHeader title="Share Directory" fallbackHref="/" />
      <main className="mx-auto w-full max-w-5xl px-4 py-5">
        <ShareHub mode={mode} title="Share Directory" description={description} />
      </main>
    </div>
  );
}
