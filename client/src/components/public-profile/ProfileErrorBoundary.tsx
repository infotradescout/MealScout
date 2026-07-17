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
        <section className="profile-surface rounded-2xl p-5 text-[color:var(--profile-ink)]">
          <p className="profile-section-label">
            MealScout profile
          </p>
          <h1 className="mt-2 text-2xl font-semibold">This profile needs a quick refresh</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--profile-muted)]">
            We could not render this profile section safely. Try refreshing the page, or head
            back to Scout while we log the issue.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              className="profile-action-primary"
              onClick={() => window.location.reload()}
            >
              Refresh profile
            </Button>
            <Link href="/scout">
              <Button variant="outline" className="profile-action-secondary">
                Scout
              </Button>
            </Link>
          </div>
        </section>
      );
    }

    return this.props.children;
  }
}
