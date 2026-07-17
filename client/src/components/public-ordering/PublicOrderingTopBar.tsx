import { Link } from "wouter";

type PublicOrderingTopBarProps = {
  secondaryHref?: string | null;
  secondaryLabel?: string;
};

export function PublicOrderingTopBar({
  secondaryHref,
  secondaryLabel = "Profile",
}: PublicOrderingTopBarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-[color:var(--profile-border)] bg-[#fffaf4]/92 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="text-base font-black tracking-tight text-[color:var(--profile-ink)]"
        >
          MealScout
        </Link>
        <div className="flex items-center gap-2">
          {secondaryHref ? (
            <Link
              href={secondaryHref}
              className="hidden text-sm font-bold text-[color:var(--profile-ink-soft)] hover:text-[color:var(--profile-accent)] sm:inline"
            >
              {secondaryLabel}
            </Link>
          ) : null}
          <Link
            href="/scout"
            className="profile-action-primary inline-flex min-h-9 items-center rounded-full px-4 text-sm font-black"
          >
            Scout
          </Link>
        </div>
      </div>
    </header>
  );
}
