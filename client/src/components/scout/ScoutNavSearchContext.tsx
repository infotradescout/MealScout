import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ScoutSearchFilterId } from "@/components/scout/ScoutSearchDock";

type ScoutNavSearchValue = {
  searchMode: boolean;
  query: string;
  activeFilter: ScoutSearchFilterId | null;
  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (value: string) => void;
  setActiveFilter: (filter: ScoutSearchFilterId | null) => void;
};

const ScoutNavSearchContext = createContext<ScoutNavSearchValue | null>(null);

export function ScoutNavSearchProvider({ children }: { children: ReactNode }) {
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] =
    useState<ScoutSearchFilterId | null>(null);

  const openSearch = useCallback(() => setSearchMode(true), []);
  const closeSearch = useCallback(() => {
    setSearchMode(false);
    setQuery("");
    setActiveFilter(null);
  }, []);

  const value = useMemo(
    () => ({
      searchMode,
      query,
      activeFilter,
      openSearch,
      closeSearch,
      setQuery,
      setActiveFilter,
    }),
    [activeFilter, closeSearch, openSearch, query, searchMode],
  );

  return (
    <ScoutNavSearchContext.Provider value={value}>
      {children}
    </ScoutNavSearchContext.Provider>
  );
}

export function useScoutNavSearch() {
  const context = useContext(ScoutNavSearchContext);
  if (!context) {
    throw new Error("useScoutNavSearch must be used inside ScoutNavSearchProvider");
  }
  return context;
}
