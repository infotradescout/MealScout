import { Link } from "wouter";
import { Search } from "lucide-react";

export function ScoutSearchDock() {
  return (
    <div className="fixed inset-x-4 z-40 md:mx-auto md:max-w-[608px]" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.1rem)" }}>
      <Link
        href="/search"
        className="flex h-12 w-full items-center justify-between rounded-full bg-[#0f1015]/92 px-4 text-sm font-semibold text-white/88 ring-1 ring-orange-400/35 backdrop-blur-xl shadow-[0_18px_44px_rgba(0,0,0,0.52)]"
        aria-label="Search dishes, cravings, places, trucks, and events"
      >
        <span className="truncate text-[13px]">Search dishes, cravings, places, trucks, or events</span>
        <Search className="h-4 w-4 shrink-0 text-orange-200" aria-hidden="true" />
      </Link>
    </div>
  );
}
