import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, Clock, TrendingUp, X, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { readDeviceLocation } from "@/lib/device-location";

// Stable session token for the lifetime of the page — rotated on full navigation.
// Sending this groups all autocomplete requests in a session into a single
// billable unit on Google's side.
const _smartSearchSessionToken: string =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

interface SearchSuggestion {
  id: string;
  text: string;
  type:
    | "restaurant"
    | "cuisine"
    | "deal"
    | "location"
    | "parking_pass"
    | "video"
    | "event";
  subtitle?: string;
  icon?: string;
}

interface PlaceSuggestion {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
}

interface SmartSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  placeholder?: string;
  className?: string;
  showSuggestions?: boolean;
}

const RECENT_SEARCHES_KEY = "mealscout_recent_searches";
const MAX_RECENT_SEARCHES = 5;

export default function SmartSearch({
  value,
  onChange,
  onSearch,
  placeholder = "Search deals, trucks, parking pass, videos...",
  className,
  showSuggestions = true,
}: SmartSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [debouncedValue, setDebouncedValue] = useState(value);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isOpeningPlace, setIsOpeningPlace] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = "smart-search-listbox";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedValue(value);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [value]);

  // Load recent searches from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (stored) {
      try {
        setRecentSearches(JSON.parse(stored));
      } catch {
        // Ignore invalid JSON
      }
    }
  }, []);

  // Get search suggestions based on current input
  const { data: suggestions } = useQuery<SearchSuggestion[]>({
    queryKey: ["/api/search/suggestions", debouncedValue],
    enabled: debouncedValue.length >= 2,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const { data: placeSuggestions } = useQuery<PlaceSuggestion[]>({
    queryKey: ["/api/map/place-autocomplete", debouncedValue],
    enabled: debouncedValue.length >= 2,
    staleTime: 5 * 60 * 1000, // match server-side cache TTL
    queryFn: async () => {
      const url = new URL("/api/map/place-autocomplete", window.location.origin);
      url.searchParams.set("input", debouncedValue);
      url.searchParams.set("sessionToken", _smartSearchSessionToken);
      const deviceLocation = readDeviceLocation();
      if (deviceLocation) {
        url.searchParams.set("lat", String(deviceLocation.lat));
        url.searchParams.set("lng", String(deviceLocation.lng));
      }
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        suggestions?: PlaceSuggestion[];
      };
      return Array.isArray(data?.suggestions) ? data.suggestions : [];
    },
  });

  const mergedSuggestions = useMemo(() => {
    const base = Array.isArray(suggestions) ? suggestions : [];
    const placeMapped: SearchSuggestion[] = Array.isArray(placeSuggestions)
      ? placeSuggestions.map((place) => ({
          id: `place:${place.placeId}`,
          text: place.text,
          type: "location",
          subtitle: place.secondaryText || place.mainText,
        }))
      : [];

    const seen = new Set<string>();
    const merged: SearchSuggestion[] = [];
    for (const item of [...base, ...placeMapped]) {
      const key = item.text.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged;
  }, [placeSuggestions, suggestions]);

  // Popular/trending searches - could be dynamic from API
  const popularSearches = [
    "Pizza deals",
    "Mexican food",
    "Burgers near me",
    "Asian cuisine",
    "Coffee shops",
    "Healthy options",
  ];

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const addToRecentSearches = (query: string) => {
    if (!query.trim()) return;

    const updatedRecent = [
      query,
      ...recentSearches.filter((search) => search !== query),
    ].slice(0, MAX_RECENT_SEARCHES);

    setRecentSearches(updatedRecent);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updatedRecent));
  };

  const removeFromRecent = (query: string) => {
    const updatedRecent = recentSearches.filter((search) => search !== query);
    setRecentSearches(updatedRecent);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updatedRecent));
  };

  const handleSearch = (query: string) => {
    if (query.trim()) {
      addToRecentSearches(query.trim());
      onSearch(query.trim());
      setIsOpen(false);
    }
  };

  const openPlaceProfile = async (suggestion: SearchSuggestion) => {
    const placeId = suggestion.id.startsWith("place:")
      ? suggestion.id.slice("place:".length)
      : "";
    if (!placeId) {
      handleSearch(suggestion.text);
      return;
    }

    setIsOpeningPlace(true);
    try {
      addToRecentSearches(suggestion.text);
      const res = await fetch(
        `/api/search/google-place/${encodeURIComponent(placeId)}/profile`,
        {
          method: "POST",
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.profileUrl) {
        window.location.href = String(body.profileUrl);
        return;
      }
    } catch {
      // Fall through to normal search if Google profile generation fails.
    } finally {
      setIsOpeningPlace(false);
    }

    onChange(suggestion.text);
    handleSearch(suggestion.text);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setIsOpen(showSuggestions && newValue.length > 0);
    setActiveIndex(-1);
  };

  const handleInputFocus = () => {
    setIsOpen(showSuggestions);
  };

  const keyboardOptions =
    value.length >= 2 && mergedSuggestions.length > 0
      ? mergedSuggestions.map((item) => item.text)
      : value.length === 0
      ? popularSearches
      : recentSearches;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
      if (keyboardOptions.length > 0) {
        setActiveIndex((prev) => (prev + 1) % keyboardOptions.length);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setIsOpen(true);
      if (keyboardOptions.length > 0) {
        setActiveIndex((prev) =>
          prev <= 0 ? keyboardOptions.length - 1 : prev - 1
        );
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen && activeIndex >= 0 && keyboardOptions[activeIndex]) {
        const selected = keyboardOptions[activeIndex];
        onChange(selected);
        handleSearch(selected);
        return;
      }
      handleSearch(value);
      return;
    }
    if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
      setActiveIndex(-1);
    }
  };

  const getSuggestionIcon = (type: SearchSuggestion["type"]) => {
    switch (type) {
      case "restaurant":
        return "🏪";
      case "cuisine":
        return "🍽️";
      case "deal":
        return "🔥";
      case "location":
        return "📍";
      default:
        return "🔍";
    }
  };

  const getSuggestionIconLabel = (type: SearchSuggestion["type"]) => {
    switch (type) {
      case "restaurant":
        return "REST";
      case "cuisine":
        return "CAT";
      case "deal":
        return "DEAL";
      case "parking_pass":
        return "PASS";
      case "video":
        return "VID";
      case "event":
        return "EVT";
      default:
        return "SRCH";
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="smart-search-shell relative flex items-center gap-2 rounded-[28px] px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-clean-lg">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--accent-text)] w-5 h-5 z-10" />
          <Input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              activeIndex >= 0 ? `smart-search-option-${activeIndex}` : undefined
            }
            className="smart-search-input w-full pl-11 pr-4 py-2.5 sm:py-3 text-sm sm:text-base rounded-full border border-transparent bg-transparent shadow-none focus:border-transparent focus:ring-2 focus:ring-[#F59E0B]/40 focus:ring-offset-0"
            data-testid="input-smart-search"
          />
        </div>
        <Button
          onClick={() => handleSearch(value)}
          className="smart-search-button h-10 sm:h-11 px-4 sm:px-6 text-sm sm:text-base font-semibold rounded-full shadow-clean-lg hover:shadow-clean-lg focus:ring-2 focus:ring-[#F59E0B]/40 focus:ring-offset-0"
          data-testid="button-search"
        >
          Search
        </Button>
      </div>

      {/* Search Suggestions Dropdown */}
      {isOpen && showSuggestions && (
        <Card
          className="absolute top-full left-0 right-0 mt-2 max-h-96 overflow-y-auto z-50 shadow-clean-lg border-2"
          role="listbox"
          id={listboxId}
        >
          <CardContent className="p-0">
            {/* Current search results */}
            {value.length >= 2 && mergedSuggestions.length > 0 && (
              <div className="border-b border-border">
                <div className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted/30">
                  Suggestions
                </div>
                {mergedSuggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    onClick={() => {
                      onChange(suggestion.text);
                      if (suggestion.id.startsWith("place:")) {
                        openPlaceProfile(suggestion);
                      } else {
                        handleSearch(suggestion.text);
                      }
                    }}
                    disabled={isOpeningPlace}
                    id={`smart-search-option-${index}`}
                    role="option"
                    aria-selected={activeIndex === index}
                    className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors flex items-center space-x-3"
                    data-testid={`suggestion-${suggestion.type}-${suggestion.id}`}
                  >
                    <span className="text-lg">
                      {getSuggestionIconLabel(suggestion.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground truncate">
                        {suggestion.text}
                      </div>
                      {suggestion.subtitle && (
                        <div className="text-sm text-muted-foreground truncate">
                          {suggestion.subtitle}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <div className="border-b border-border">
                <div className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted/30 flex items-center space-x-2">
                  <Clock className="w-4 h-4" />
                  <span>Recent</span>
                </div>
                {recentSearches.map((search, index) => {
                  const optionIndex =
                    value.length >= 2 && mergedSuggestions.length > 0
                      ? mergedSuggestions.length + index
                      : index;
                  return (
                  <div
                    key={index}
                    className="flex items-center hover:bg-muted/50 transition-colors"
                  >
                    <button
                      onClick={() => {
                        onChange(search);
                        handleSearch(search);
                      }}
                      id={`smart-search-option-${optionIndex}`}
                      role="option"
                      aria-selected={activeIndex === optionIndex}
                      className="flex-1 px-4 py-3 text-left flex items-center space-x-3"
                      data-testid={`recent-search-${index}`}
                    >
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-foreground">{search}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromRecent(search);
                      }}
                      className="p-2 mr-2 hover:bg-muted rounded-full transition-colors"
                      data-testid={`remove-recent-${index}`}
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}

            {/* Popular/Trending Searches */}
            {value.length === 0 && (
              <div>
                <div className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted/30 flex items-center space-x-2">
                  <TrendingUp className="w-4 h-4" />
                  <span>Popular</span>
                </div>
                {popularSearches.map((search, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      onChange(search);
                      handleSearch(search);
                    }}
                    id={`smart-search-option-${index}`}
                    role="option"
                    aria-selected={activeIndex === index}
                    className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors flex items-center space-x-3"
                    data-testid={`popular-search-${index}`}
                  >
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    <span className="text-foreground">{search}</span>
                  </button>
                ))}
              </div>
            )}

            {/* No results state */}
            {value.length >= 2 &&
              mergedSuggestions.length === 0 && (
                <div className="px-4 py-8 text-center text-muted-foreground">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No suggestions found</p>
                  <p className="text-sm">
                    Try searching for restaurants, cuisines, or deals
                  </p>
                </div>
              )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

