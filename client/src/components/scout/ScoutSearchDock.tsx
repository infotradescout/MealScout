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
  placement?: "fixed" | "inline" | "navigation";
  onOpen: () => void;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onFilterChange: (filter: ScoutSearchFilterId | null) => void;
}) {
  const isNavigationPlacement = placement === "navigation";
  const shellClassName = isNavigationPlacement
    ? "w-full"
    : placement === "inline"
      ? "px-4 pb-4 md:mx-auto md:max-w-[608px]"
      : "fixed inset-x-4 z-40 md:mx-auto md:max-w-[608px]";
  const shellStyle =
    placement === "fixed"
      ? { bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.1rem)" }
      : undefined;

  const formClassName = isNavigationPlacement
    ? `overflow-hidden bg-transparent text-[color:var(--text-primary)] ${
        searchMode ? "ring-1 ring-inset ring-primary/45" : ""
      }`
    : `overflow-hidden rounded-[1.4rem] bg-[#fff7ed]/94 text-[#241208] ring-1 backdrop-blur-xl shadow-[0_16px_34px_rgba(92,45,18,0.22)] ${
        searchMode ? "ring-orange-300/70" : "ring-orange-200/70"
      }`;

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
        className={formClassName}
      >
        <div
          className={`flex w-full items-center gap-2 px-3 ${
            isNavigationPlacement ? "min-h-[42px]" : "min-h-12"
          }`}
        >
          <Search
            className={`h-4 w-4 shrink-0 ${
              isNavigationPlacement ? "text-primary" : "text-orange-600"
            }`}
            aria-hidden="true"
          />
          <input
            value={query}
            onFocus={onOpen}
            onChange={(event) => {
              onOpen();
              onQueryChange(event.target.value);
            }}
            className={`${
              isNavigationPlacement ? "h-[42px]" : "h-12"
            } min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none ${
              isNavigationPlacement
                ? "text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)]"
                : "text-[#241208] placeholder:text-stone-500"
            }`}
            placeholder="Search dishes, cravings, places, trucks, or events"
            aria-label="Search dishes, cravings, places, trucks, and events"
          />
          {searchMode ? (
            <button
              type="button"
              onClick={onClose}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                isNavigationPlacement
                  ? "bg-[var(--bg-surface-muted)] text-[color:var(--text-primary)]"
                  : "bg-orange-100/80 text-orange-900 ring-1 ring-orange-200/70 active:bg-orange-200/90"
              }`}
              aria-label="Close Scout search"
              data-scout-search-close="true"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {searchMode ? (
          <div
            className={`border-t px-3 pb-3 pt-2 ${
              isNavigationPlacement
                ? "border-[color:var(--border-subtle)]"
                : "border-orange-200/60"
            }`}
            data-scout-search-filters="true"
          >
            {resultSummary ? (
              <p
                className={`mb-2 text-[11px] font-semibold ${
                  isNavigationPlacement
                    ? "text-[color:var(--text-muted)]"
                    : "text-stone-600"
                }`}
              >
                {resultSummary}
              </p>
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
                        ? "bg-primary text-primary-foreground ring-primary/35"
                        : isNavigationPlacement
                          ? "bg-[var(--bg-surface-muted)] text-[color:var(--text-primary)] ring-[color:var(--border-subtle)]"
                          : "bg-white/72 text-stone-700 ring-orange-200/70"
                    }`}
                    aria-pressed={selected}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : !isNavigationPlacement ? (
          <p className="border-t border-orange-200/50 px-4 pb-2 text-[11px] font-semibold text-stone-500">
            {resultSummary || "Fresh nearby picks update as you search."}
          </p>
        ) : null}
      </form>
    </div>
  );

  if (placement === "fixed" && typeof document !== "undefined") {
    return createPortal(dockContent, document.body);
  }
  return dockContent;
}
