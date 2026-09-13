import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl } from "@/lib/api";

export type ScoutManualLocation = { label: string; lat: number; lng: number; source: "manual" };
const STORAGE_KEY = "mealscout:scout-location:v1";
export function readScoutManualLocation(): ScoutManualLocation | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!value || typeof value.label !== "string" || !value.label.trim() || value.label.length > 200 ||
      typeof value.lat !== "number" || !Number.isFinite(value.lat) || Math.abs(value.lat) > 90 ||
      typeof value.lng !== "number" || !Number.isFinite(value.lng) || Math.abs(value.lng) > 180) return null;
    return { label: value.label.trim(), lat: value.lat, lng: value.lng, source: "manual" };
  } catch { return null; }
}
export function persistScoutManualLocation(value: ScoutManualLocation | null) {
  try { if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); else localStorage.removeItem(STORAGE_KEY); }
  catch { /* Location selection still works when browser storage is unavailable. */ }
}

export function ScoutLocationPicker({ label, onSelect, onUseDevice }: {
  label: string; onSelect: (location: ScoutManualLocation) => void; onUseDevice: () => void;
}) {
  const [open,setOpen] = useState(false);
  const [input,setInput] = useState("");
  const [search,setSearch] = useState("");
  const result = useQuery<Array<{ label: string; lat: number; lng: number }>>({
    queryKey: ["scout-location-search", search], enabled: open && search.length >= 2,
    queryFn: async ({ signal }) => {
      const response = await fetch(apiUrl(`/api/location/search?q=${encodeURIComponent(search)}&limit=5`), { signal });
      if (!response.ok) throw new Error("Location search is unavailable. Please try again.");
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error("Location search is unavailable. Please try again.");
      return rows.map((row) => ({ label: String(row.display_name || search), lat: Number(row.lat), lng: Number(row.lon) }))
        .filter((row) => Number.isFinite(row.lat) && Math.abs(row.lat) <= 90 && Number.isFinite(row.lng) && Math.abs(row.lng) <= 180);
    }, retry: false, staleTime: 60_000,
  });
  return <>
    <button type="button" aria-label={`Change location: ${label}`} onClick={() => setOpen(true)}
      className="inline-flex max-w-[15rem] items-center gap-1.5 rounded-full bg-[var(--bg-popup)] px-2.5 py-1.5 text-[11px] font-black text-[color:var(--text-primary)] ring-1 ring-[color:var(--border-subtle)] shadow-sm">
      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{label}</span><span aria-hidden="true">▾</span>
    </button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogHeader><DialogTitle>Choose your area</DialogTitle><DialogDescription>Search a city, state, or ZIP code to explore food nearby.</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        const nextSearch = input.trim();
        if (nextSearch.length < 2) return;
        if (nextSearch === search) void result.refetch();
        else setSearch(nextSearch);
      }}>
        <label htmlFor="scout-location-query" className="text-sm font-medium">City or ZIP code</label>
        <div className="flex gap-2"><Input id="scout-location-query" value={input} onChange={(event) => setInput(event.target.value)} maxLength={200} placeholder="e.g. Austin, TX" />
          <Button type="submit" disabled={input.trim().length < 2 || result.isFetching}>Search</Button></div>
      </form>
      <div aria-live="polite" className="space-y-2">
        {result.isFetching ? <p>Finding your area…</p> : result.isError ? <p role="alert">Location search is unavailable. Please try again.</p> : search && result.data?.length === 0 ? <p>No matching location. Try adding a state or ZIP code.</p> : null}
        {result.data?.map((item) => <Button key={`${item.lat}:${item.lng}`} className="h-auto w-full justify-start whitespace-normal text-left" variant="outline" onClick={() => {
          onSelect({ ...item, source: "manual" }); setOpen(false);
        }}>{item.label}</Button>)}
      </div>
      <Button variant="secondary" onClick={() => { onUseDevice(); setOpen(false); }}>Use my current location</Button>
    </DialogContent></Dialog>
  </>;
}
