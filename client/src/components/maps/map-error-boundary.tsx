import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  message: string | null;
};

export class MapErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || "Map crashed unexpectedly.",
    };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("[MapErrorBoundary]", error);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="absolute inset-0 z-[1500] flex items-center justify-center bg-[hsl(var(--background))/0.85] p-4 backdrop-blur">
        <div className="max-w-sm rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 text-center shadow-clean">
          <p className="text-sm font-semibold text-foreground">
            Map failed to load
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {this.state.message || "Something went wrong rendering the map."}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.reload()}
              data-testid="button-map-error-reload"
            >
              Reload page
            </Button>
            <Button
              size="sm"
              onClick={this.handleRetry}
              data-testid="button-map-error-retry"
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
