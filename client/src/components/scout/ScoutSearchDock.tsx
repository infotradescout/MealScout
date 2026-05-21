import { Link } from "wouter";
import { Search } from "lucide-react";

export function ScoutSearchDock() {
  return (
    <div className="fixed inset-x-4 z-40 md:mx-auto md:max-w-[608px]" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.25rem)" }}>
      <Link
        href="/search"
        className="flex h-12 w-full items-center justify-between rounded-full bg-[#0d0f15]/88 px-4 text-sm font-semibold text-white/85 ring-1 ring-orange-300/30 backdrop-blur-xl shadow-[0_14px_34px_rgba(0,0,0,0.42)]"
        aria-label="Search food, places, trucks, events"
      >
        <span className="truncate">Search food, places, trucks, events</span>
        <Search className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
      </Link>
    </div>
  );
}
