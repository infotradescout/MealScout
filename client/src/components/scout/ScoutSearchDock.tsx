import { Search, X } from "lucide-react";
import { createPortal } from "react-dom";

export type ScoutSearchFilterId =
  | "now"
  | "trucks"
  | "restaurants"
  | "dishes"
  | "deals"
  | "happy_hour"
  | "events"
  | "community"
  | "new"
  | "best";

const SEARCH_FILTERS: Array<{ id: ScoutSearchFilterId; label: string }> = [
  { id: "now", label: "Now" },
  { id: "trucks", label: "Trucks" },
  { id: "restaurants", label: "Restaurants" },
  { id: "dishes", label: "Dishes" },
  { id: "deals", label: "Deals" },
  { id: "happy_hour", label: "Happy Hour" },
  { id: "events", label: "Events" },
  { id: "community", label: "Community Picks" },
  { id: "new", label: "New" },
  { id: "best", label: "Best" },
];

export function ScoutSearchDock({
  searchMode,
  query,
  activeFilter,
  resultSummary,
  placement = "fixed",
  onOpen,
  onClose,
  onQueryChange,
  onFilterChange,
}: {
  searchMode: boolean;
  query: string;
  activeFilter: ScoutSearchFilterId | null;
  resultSummary?: string | null;
  placement?: "fixed" | "inline";
  onOpen: () => void;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onFilterChange: (filter: ScoutSearchFilterId | null) => void;
}) {
  const shellClassName =
    placement === "inline"
      ? "px-4 pb-4 md:mx-auto md:max-w-[608px]"
      : "fixed inset-x-4 z-40 md:mx-auto md:max-w-[608px]";
  const shellStyle =
    placement === "inline"
      ? undefined
      : { bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.1rem)" };

  const dockContent = (
    <div
      className={shellClassName}
      style={shellStyle}
      data-scout-search-placement={placement}
    >
      <form
        role="search"
        data-scout-search-mode={searchMode ? "active" : "default"}
        onSubmit={(event) => {
          event.preventDefault();
          onOpen();
        }}
        className={`overflow-hidden rounded-[1.4rem] bg-[#0f0a07]/94 text-white ring-1 backdrop-blur-xl shadow-[0_18px_44px_rgba(0,0,0,0.52)] ${
          searchMode ? "ring-orange-300/40" : "ring-orange-400/35"
        }`}
      >
        <div className="flex min-h-12 w-full items-center gap-2 px-3">
          <Search className="h-4 w-4 shrink-0 text-orange-200" aria-hidden="true" />
          <input
            value={query}
            onFocus={onOpen}
            onChange={(event) => {
              onOpen();
              onQueryChange(event.target.value);
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-white/90 outline-none placeholder:text-white/48"
            placeholder="Search dishes, cravings, places, trucks, or events"
            aria-label="Search dishes, cravings, places, trucks, and events"
          />
          {searchMode ? (
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-white/78 ring-1 ring-white/10 active:bg-white/12"
              aria-label="Close Scout search"
              data-scout-search-close="true"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {searchMode ? (
          <div className="border-t border-white/8 px-3 pb-3 pt-2" data-scout-search-filters="true">
            {resultSummary ? (
              <p className="mb-2 text-[11px] font-semibold text-white/58">{resultSummary}</p>
            ) : null}
            <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-0.5 atmo-hide-scrollbar">
              {SEARCH_FILTERS.map((filter) => {
                const selected = activeFilter === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => onFilterChange(selected ? null : filter.id)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] ring-1 ${
                      selected
                        ? "bg-orange-400 text-[#1c0d07] ring-orange-200/60"
                        : "bg-white/[0.055] text-white/72 ring-white/10"
                    }`}
                    aria-pressed={selected}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="border-t border-white/6 px-4 pb-2 text-[11px] font-semibold text-white/46">
            {resultSummary || "Updates live on the map and feed."}
          </p>
        )}
      </form>
    </div>
  );

  if (placement === "fixed" && typeof document !== "undefined") {
    return createPortal(dockContent, document.body);
  }
  return dockContent;
}
