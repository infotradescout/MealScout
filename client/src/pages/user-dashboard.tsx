import { useEffect } from "react";
import { Heart } from "lucide-react";
import { useLocation } from "wouter";

/**
 * Compatibility entry for older account and campaign links.
 * Consumer discovery lives in Scout; a diner's durable collection lives in Saved.
 */
export default function UserDashboard() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/favorites", { replace: true });
  }, [setLocation]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)] px-4 text-center">
      <div>
        <Heart
          className="mx-auto h-7 w-7 animate-pulse text-[color:var(--accent-text)]"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm text-[color:var(--text-muted)]">
          Opening Saved…
        </p>
      </div>
    </main>
  );
}
