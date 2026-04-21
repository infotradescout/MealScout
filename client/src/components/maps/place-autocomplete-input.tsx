import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PlaceSuggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

type AutocompleteResponse = {
  suggestions?: PlaceSuggestion[];
};

type PlaceAutocompleteInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: PlaceSuggestion) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  dataTestId?: string;
};

/**
 * Generates a UUID v4-compatible session token.
 * A new token is created when the component mounts and is reused for the
 * lifetime of the autocomplete session (all keystrokes until the user selects
 * a suggestion). The same token must be sent with the subsequent place-details
 * request so Google bills the entire session as a single "Autocomplete
 * (included with Place Details)" call instead of charging per keystroke.
 */
function generateSessionToken(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function PlaceAutocompleteInput({
  id,
  value,
  onChange,
  onSelect,
  placeholder,
  disabled = false,
  className,
  inputClassName,
  dataTestId,
}: PlaceAutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [debouncedValue, setDebouncedValue] = useState(value);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Session token: created once per component mount, rotated after a selection.
  // Sending this token groups all autocomplete requests + the final place-details
  // request into a single billable session on Google's side.
  const sessionTokenRef = useRef<string>(generateSessionToken());

  // Debounce: 300ms — slightly longer than before to reduce API calls further
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedValue(value);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [value]);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const trimmed = debouncedValue.trim();
      if (trimmed.length < 2 || disabled) {
        setSuggestions([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const url = new URL("/api/map/place-autocomplete", window.location.origin);
        url.searchParams.set("input", trimmed);
        url.searchParams.set("sessionToken", sessionTokenRef.current);

        const res = await fetch(url.toString(), { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) setSuggestions([]);
          return;
        }
        const data = (await res.json()) as AutocompleteResponse;
        if (!cancelled) {
          setSuggestions(
            Array.isArray(data?.suggestions)
              ? data.suggestions.filter((item) => Boolean(item?.placeId))
              : [],
          );
          setIsOpen(true);
          setActiveIndex(-1);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [debouncedValue, disabled]);

  const hasSuggestions = suggestions.length > 0;
  const optionIds = useMemo(
    () => suggestions.map((_, index) => `${id || "place-autocomplete"}-opt-${index}`),
    [id, suggestions],
  );

  const selectSuggestion = (suggestion: PlaceSuggestion) => {
    onChange(suggestion.text);
    // Pass the current session token to the caller so they can include it in
    // the subsequent place-details request for billing grouping.
    onSelect({ ...suggestion, _sessionToken: sessionTokenRef.current } as any);
    setIsOpen(false);
    setActiveIndex(-1);
    // Rotate the session token — the next autocomplete session is a new billing unit
    sessionTokenRef.current = generateSessionToken();
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          onKeyDown={(event) => {
            if (!isOpen || !hasSuggestions) {
              if (event.key === "ArrowDown" && suggestions.length > 0) {
                setIsOpen(true);
                setActiveIndex(0);
              }
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((prev) => (prev + 1) % suggestions.length);
              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((prev) =>
                prev <= 0 ? suggestions.length - 1 : prev - 1,
              );
              return;
            }

            if (event.key === "Enter") {
              if (activeIndex >= 0 && suggestions[activeIndex]) {
                event.preventDefault();
                selectSuggestion(suggestions[activeIndex]);
              }
              return;
            }

            if (event.key === "Escape") {
              setIsOpen(false);
              setActiveIndex(-1);
            }
          }}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={id ? `${id}-listbox` : undefined}
          aria-activedescendant={
            activeIndex >= 0 ? optionIds[activeIndex] : undefined
          }
          data-testid={dataTestId}
          className={cn("pl-9", inputClassName)}
        />
      </div>

      {isOpen && (isLoading || hasSuggestions) && (
        <Card
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-72 overflow-y-auto border"
          role="listbox"
          id={id ? `${id}-listbox` : undefined}
        >
          <CardContent className="p-1">
            {isLoading && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Looking up places...
              </div>
            )}
            {!isLoading &&
              suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.placeId}
                  type="button"
                  role="option"
                  id={optionIds[index]}
                  aria-selected={activeIndex === index}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/70",
                    activeIndex === index ? "bg-muted" : "",
                  )}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {suggestion.mainText || suggestion.text}
                    </span>
                    {suggestion.secondaryText && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {suggestion.secondaryText}
                      </span>
                    )}
                  </span>
                </button>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
