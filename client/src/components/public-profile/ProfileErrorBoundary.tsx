import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";

type ProfileErrorBoundaryProps = {
  children: ReactNode;
  onPageError: () => void;
};

type ProfileErrorBoundaryState = {
  hasError: boolean;
};

export class ProfileErrorBoundary extends Component<
  ProfileErrorBoundaryProps,
  ProfileErrorBoundaryState
> {
  state: ProfileErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    this.props.onPageError();
  }

  render() {
    if (this.state.hasError) {
      return (
        <section className="rounded-xl border border-orange-300/25 bg-[#0f0d0b] p-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-200/80">
            MealScout profile
          </p>
          <h1 className="mt-2 text-2xl font-semibold">This profile needs a quick refresh</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/75">
            We could not render this profile section safely. Try refreshing the page, or head
            back to Scout while we log the issue.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              className="bg-orange-500 text-black hover:bg-orange-400"
              onClick={() => window.location.reload()}
            >
              Refresh profile
            </Button>
            <Link href="/scout">
              <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
                Back to Scout
              </Button>
            </Link>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
