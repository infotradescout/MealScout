import ShareHub from "@/components/share-hub";
import { BackHeader } from "@/components/back-header";
import { useAuth } from "@/hooks/useAuth";

export default function ShareHubPage() {
  const { user } = useAuth();
  const userType = String(user?.userType || "");

  const mode =
    userType === "admin" ||
    userType === "duper_admin" ||
    userType === "super_admin"
      ? "admin"
      : userType === "staff"
        ? "staff"
        : "user";

  const description =
    mode === "user"
      ? "One-tap links you can share right now to bring in restaurant owners, food trucks, and host locations."
      : "Quick-share portal for growth ops and outreach.";

  return (
    <div className="min-h-screen pb-28">
      <BackHeader title="Share Hub" fallbackHref="/" />
      <main className="mx-auto w-full max-w-5xl px-4 py-5">
        <ShareHub mode={mode} title="Share Hub" description={description} />
      </main>
    </div>
  );
}
