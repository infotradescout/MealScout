import type { ReactNode } from "react";
import {
  CalendarDays,
  Compass,
  Heart,
  RotateCcw,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConsumerCollectionSection = "saved" | "deals" | "events";

const collectionLinks: Array<{
  id: ConsumerCollectionSection;
  label: string;
  href: string;
  icon: LucideIcon;
}> = [
  { id: "saved", label: "Saved", href: "/favorites", icon: Heart },
  { id: "deals", label: "Deals", href: "/deals", icon: Tag },
  { id: "events", label: "Events", href: "/events/public", icon: CalendarDays },
];

type ConsumerCollectionShellProps = {
  section: ConsumerCollectionSection;
  title: string;
  description: string;
  icon: LucideIcon;
  countLabel?: string | null;
  children: ReactNode;
};

export function ConsumerCollectionShell({
  section,
  title,
  description,
  icon: Icon,
  countLabel,
  children,
}: ConsumerCollectionShellProps) {
  return (
    <div
      data-consumer-collection-shell="true"
      className="min-h-screen bg-[radial-gradient(circle_at_8%_0%,rgba(255,171,105,0.22),transparent_24rem),radial-gradient(circle_at_92%_7%,rgba(255,218,121,0.16),transparent_22rem),linear-gradient(180deg,#fffaf4_0%,#fffdf9_48%,#fff7ed_100%)] text-[#2b160d]"
    >
      <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6 sm:pt-6 lg:pb-12">
        <header className="flex items-start justify-between gap-4 py-2 sm:items-center">
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f4512c] text-white shadow-[0_10px_26px_rgba(244,81,44,0.22)]">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="font-display text-3xl leading-none tracking-[0.02em] sm:text-4xl">
                  {title}
                </h1>
                {countLabel ? (
                  <span className="text-xs font-bold text-[#806657]">
                    {countLabel}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-5 text-[#6b5041]">
                {description}
              </p>
            </div>
          </div>
          <Button
            asChild
            className="hidden min-h-11 shrink-0 rounded-full bg-[#f4512c] px-5 font-black text-white shadow-[0_10px_24px_rgba(244,81,44,0.2)] hover:bg-[#dc3f1e] sm:inline-flex"
          >
            <Link href="/scout">
              <Compass className="mr-2 h-4 w-4" aria-hidden="true" />
              Scout
            </Link>
          </Button>
        </header>

        <nav
          aria-label="MealScout collections"
          className="mt-5 overflow-x-auto border-y border-[#683a1f]/10 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex min-w-max items-center gap-1">
            {collectionLinks.map((item) => {
              const ItemIcon = item.icon;
              const isActive = item.id === section;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold transition-colors",
                    isActive
                      ? "bg-[#2b160d] text-white"
                      : "text-[#6b5041] hover:bg-[#fff0e8] hover:text-[#2b160d]",
                  )}
                >
                  <ItemIcon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <main className="pt-6">{children}</main>
      </div>
    </div>
  );
}

type CollectionStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  onRetry?: () => void;
};

export function CollectionState({
  icon: Icon,
  title,
  description,
  actionHref,
  actionLabel,
  onRetry,
}: CollectionStateProps) {
  return (
    <section
      role={onRetry ? "alert" : "status"}
      className="mx-auto flex max-w-xl flex-col items-center rounded-[1.75rem] border border-[#683a1f]/15 bg-white/[0.88] px-6 py-12 text-center shadow-[0_20px_55px_rgba(102,50,21,0.08)]"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff0e8] text-[#f4512c]">
        <Icon className="h-7 w-7" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-xl font-black text-[#2b160d]">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#6b5041]">
        {description}
      </p>
      {onRetry ? (
        <Button
          type="button"
          onClick={onRetry}
          variant="outline"
          className="mt-6 min-h-11 rounded-full border-[#683a1f]/20 bg-white px-5 font-bold text-[#2b160d]"
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      ) : actionHref && actionLabel ? (
        <Button
          asChild
          className="mt-6 min-h-11 rounded-full bg-[#f4512c] px-6 font-black text-white hover:bg-[#dc3f1e]"
        >
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      ) : null}
    </section>
  );
}

export function CollectionLoadingState({ label }: { label: string }) {
  return (
    <div aria-live="polite" aria-busy="true" className="space-y-4">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="grid min-h-32 animate-pulse grid-cols-[6.5rem_minmax(0,1fr)] overflow-hidden rounded-[1.5rem] border border-[#683a1f]/10 bg-white/80 sm:grid-cols-[9rem_minmax(0,1fr)]"
        >
          <div className="bg-[#f2dfd2]" />
          <div className="space-y-3 p-5">
            <div className="h-4 w-2/3 rounded-full bg-[#ead8cb]" />
            <div className="h-3 w-1/2 rounded-full bg-[#f0e3d9]" />
            <div className="h-3 w-4/5 rounded-full bg-[#f0e3d9]" />
          </div>
        </div>
      ))}
    </div>
  );
}
