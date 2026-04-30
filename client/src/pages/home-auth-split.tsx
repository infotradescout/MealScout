import { lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import LaunchHome from "@/pages/launch-home";

const LoggedInHome = lazy(() => import("@/pages/home-v2"));

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

  return <LaunchHome />;
}
