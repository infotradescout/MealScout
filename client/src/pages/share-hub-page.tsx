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
      ? "A quick directory of shareable MealScout links for customers, business owners, food trucks, and host locations."
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
