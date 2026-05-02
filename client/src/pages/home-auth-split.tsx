import { lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";

const LoggedInHome = lazy(() => import("@/pages/home"));
const LoggedOutSignup = lazy(() => import("@/pages/customer-signup"));

const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-[var(--bg-surface)]">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

export default function HomeAuthSplit() {
  const { authState, isAuthenticated } = useAuth();

  if (authState === "loading") {
    return <PageLoader />;
  }

  if (isAuthenticated) {
    return (
      <Suspense fallback={<PageLoader />}>
        <LoggedInHome />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <LoggedOutSignup homePage />
    </Suspense>
  );
}
