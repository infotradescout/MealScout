import { createElement, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";

const LoggedInHome = lazy(() => import("@/pages/home"));
const LoggedOutSignup = lazy(() => import("@/pages/customer-signup"));

const PageLoader = () =>
  createElement(
    "div",
    {
      className:
        "flex min-h-screen items-center justify-center bg-[var(--bg-surface)]",
    },
    createElement("div", {
      className:
        "h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent",
    }),
  );

export default function HomeV2AuthSplit() {
  const { authState, isAuthenticated } = useAuth();

  if (authState === "loading") {
    return createElement(PageLoader);
  }

  if (isAuthenticated) {
    return createElement(
      Suspense,
      { fallback: createElement(PageLoader) },
      createElement(LoggedInHome),
    );
  }

  return createElement(
    Suspense,
    { fallback: createElement(PageLoader) },
    createElement(LoggedOutSignup, { homePage: true }),
  );
}
