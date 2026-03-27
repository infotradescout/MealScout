import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Calendar } from "lucide-react";
import { format } from "date-fns";

interface EditOccurrenceDialogProps {
  event: {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    maxTrucks: number;
    hardCapEnabled?: boolean;
    breakfastPriceCents?: number | null;
    lunchPriceCents?: number | null;
    dinnerPriceCents?: number | null;
    weeklyPriceCents?: number | null;
    monthlyPriceCents?: number | null;
    seriesId?: string | null;
  } | null;
  seriesName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEventUpdated: () => void;
}

export function EditOccurrenceDialog({
  event,
  seriesName,
  open,
  onOpenChange,
  onEventUpdated,
}: EditOccurrenceDialogProps) {
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [maxTrucks, setMaxTrucks] = useState(1);
  const [hardCapEnabled, setHardCapEnabled] = useState(false);
  const [breakfastPrice, setBreakfastPrice] = useState("0.00");
  const [lunchPrice, setLunchPrice] = useState("0.00");
  const [dinnerPrice, setDinnerPrice] = useState("0.00");
  const [autoWeekly, setAutoWeekly] = useState(true);
  const [weeklyPrice, setWeeklyPrice] = useState("0.00");
  const [autoMonthly, setAutoMonthly] = useState(true);
  const [monthlyPrice, setMonthlyPrice] = useState("0.00");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form when event changes
  useEffect(() => {
    if (event) {
      setStartTime(event.startTime);
      setEndTime(event.endTime);
      setMaxTrucks(event.maxTrucks);
      setHardCapEnabled(event.hardCapEnabled || false);

      const centsToDollars = (cents?: number | null) =>
        ((Number(cents || 0) || 0) / 100).toFixed(2);

      const breakfastCents = Number(event.breakfastPriceCents || 0) || 0;
      const lunchCents = Number(event.lunchPriceCents || 0) || 0;
      const dinnerCents = Number(event.dinnerPriceCents || 0) || 0;
      const slotSumCents = breakfastCents + lunchCents + dinnerCents;

      setBreakfastPrice(centsToDollars(breakfastCents));
      setLunchPrice(centsToDollars(lunchCents));
      setDinnerPrice(centsToDollars(dinnerCents));

      const weeklyCents = Number(event.weeklyPriceCents || 0) || 0;
      const monthlyCents = Number(event.monthlyPriceCents || 0) || 0;
      const weeklyDerived = slotSumCents * 7;
      const monthlyDerived = slotSumCents * 30;
      const weeklyIsDerived = weeklyCents === weeklyDerived;
      const monthlyIsDerived = monthlyCents === monthlyDerived;

      setAutoWeekly(weeklyIsDerived);
      setWeeklyPrice(centsToDollars(weeklyCents));
      setAutoMonthly(monthlyIsDerived);
      setMonthlyPrice(centsToDollars(monthlyCents));

      setError("");
    }
  }, [event]);

  const dollarsToCents = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error("Prices must be valid non-negative numbers");
    }
    return Math.round(parsed * 100);
  };

  const parseDollars = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  };

  const slotSumDollars =
    parseDollars(breakfastPrice) + parseDollars(lunchPrice) + parseDollars(dinnerPrice);
  const weeklyAutoDollars = slotSumDollars * 7;
  const monthlyAutoDollars = slotSumDollars * 30;
  const weeklyFinalDollars = autoWeekly ? weeklyAutoDollars : parseDollars(weeklyPrice);
  const monthlyFinalDollars = autoMonthly ? monthlyAutoDollars : parseDollars(monthlyPrice);
  const formatMoney = (value: number) => `$${value.toFixed(2)}`;

  const handleSave = async () => {
    if (!event) return;

    setError("");
    setIsSubmitting(true);

    try {
      const breakfastCents = dollarsToCents(breakfastPrice);
      const lunchCents = dollarsToCents(lunchPrice);
      const dinnerCents = dollarsToCents(dinnerPrice);

      if (breakfastCents + lunchCents + dinnerCents <= 0) {
        throw new Error("At least one slot price is required.");
      }

      const res = await fetch(`/api/hosts/parking-pass/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime,
          endTime,
          maxTrucks,
          hardCapEnabled,
          breakfastPriceCents: breakfastCents,
          lunchPriceCents: lunchCents,
          dinnerPriceCents: dinnerCents,
          weeklyPriceCents: autoWeekly ? null : dollarsToCents(weeklyPrice),
          monthlyPriceCents: autoMonthly ? null : dollarsToCents(monthlyPrice),
          applyToFuture: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update parking pass listing");
      }

      onOpenChange(false);
      onEventUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!event) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl">
        <DialogHeader>
        <DialogTitle>Edit Parking Pass Listing</DialogTitle>
          <DialogDescription>
            Update time window, capacity, pricing, or enforcement for this listing.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {seriesName && (
          <Alert>
            <Calendar className="h-4 w-4" />
            <AlertTitle>Part of Series: {seriesName}</AlertTitle>
            <AlertDescription>
              Changes apply to <strong>{format(new Date(event.date), "MMMM d, yyyy")}</strong>{" "}
              and future dates in this series.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="bg-[var(--bg-surface)] border rounded-md p-3 text-sm">
            <div className="flex items-center gap-2 text-[color:var(--text-muted)]">
              <Calendar className="h-4 w-4" />
              <span className="font-medium">{format(new Date(event.date), "EEEE, MMMM d, yyyy")}</span>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-start-time">Start Time</Label>
              <Input
                id="edit-start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-end-time">End Time</Label>
              <Input
                id="edit-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-max-trucks">Max Trucks</Label>
              <Input
                id="edit-max-trucks"
                type="number"
                min="1"
                max="20"
                value={maxTrucks}
                onChange={(e) => setMaxTrucks(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="border p-4 rounded-md border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="font-semibold text-slate-900">Slot pricing</p>
                <p className="text-sm text-slate-500">
                  Meal slots are one-day bookings. Daily is the sum of meal prices.
                </p>
              </div>
            </div>

            <div className="mt-4 grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-price-breakfast">Breakfast ($)</Label>
                <Input
                  id="edit-price-breakfast"
                  type="number"
                  min="0"
                  step="0.01"
                  value={breakfastPrice}
                  onChange={(e) => setBreakfastPrice(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-price-lunch">Lunch ($)</Label>
                <Input
                  id="edit-price-lunch"
                  type="number"
                  min="0"
                  step="0.01"
                  value={lunchPrice}
                  onChange={(e) => setLunchPrice(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-price-dinner">Dinner ($)</Label>
                <Input
                  id="edit-price-dinner"
                  type="number"
                  min="0"
                  step="0.01"
                  value={dinnerPrice}
                  onChange={(e) => setDinnerPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="edit-auto-weekly"
                      checked={autoWeekly}
                      onCheckedChange={setAutoWeekly}
                    />
                    <Label htmlFor="edit-auto-weekly" className="font-semibold">
                      Weekly auto
                    </Label>
                  </div>
                  <span className="text-sm text-slate-700">
                    {formatMoney(weeklyAutoDollars)}
                  </span>
                </div>
                {!autoWeekly && (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={weeklyPrice}
                    onChange={(e) => setWeeklyPrice(e.target.value)}
                    placeholder="0.00"
                  />
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="edit-auto-monthly"
                      checked={autoMonthly}
                      onCheckedChange={setAutoMonthly}
                    />
                    <Label htmlFor="edit-auto-monthly" className="font-semibold">
                      Monthly auto
                    </Label>
                  </div>
                  <span className="text-sm text-slate-700">
                    {formatMoney(monthlyAutoDollars)}
                  </span>
                </div>
                {!autoMonthly && (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={monthlyPrice}
                    onChange={(e) => setMonthlyPrice(e.target.value)}
                    placeholder="0.00"
                  />
                )}
              </div>
            </div>

            <div className="mt-4 rounded-md border bg-[var(--bg-surface)] p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[color:var(--text-muted)]">Daily</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(slotSumDollars)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[color:var(--text-muted)]">Weekly</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(weeklyFinalDollars)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[color:var(--text-muted)]">Monthly</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(monthlyFinalDollars)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-4 border p-4 rounded-md border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <Switch
              id="edit-hard-cap"
              checked={hardCapEnabled}
              onCheckedChange={setHardCapEnabled}
            />
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="edit-hard-cap" className="font-semibold">
                  Capacity Guard v2.2
                </Label>
                <Badge variant="secondary" className="text-xs">Listing</Badge>
              </div>
              <p className="text-sm text-slate-500">
                Strictly enforces capacity limits. Once full, no further approvals allowed.
              </p>
            </div>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Important</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                <li>Updates apply to this date and future dates for this listing.</li>
                <li>If capacity is reduced, existing accepted trucks are not automatically removed.</li>
                <li>Capacity Guard enforcement applies immediately after save.</li>
              </ul>
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

