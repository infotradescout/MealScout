import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

type HostLocationManagerProps = {
  canEdit?: boolean;
};

const normalize = (value?: string | null) => (value ?? "").trim();

const includesLoose = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase());

const toCents = (value: string) => {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100);
};

const toDollars = (cents: unknown) => {
  const num = Number(cents ?? 0);
  if (!Number.isFinite(num) || num <= 0) return "";
  return String((num / 100).toFixed(0));
};

const coerceCents = (value: unknown) => {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.max(0, Math.round(num));
};

const applySlotSumToDailyIfAuto = (prev: any, nextSlotSumCents: number) => {
  if (prev?._dailyOnlySelected) return prev;
  const derivedSlotSum = Math.max(0, Math.round(nextSlotSumCents));
  if (derivedSlotSum <= 0) return prev;

  const nextDaily = prev?._dailyManuallyEdited
    ? coerceCents(prev?.parkingPassDailyPriceCents)
    : derivedSlotSum;
  const nextWeekly = prev?._weeklyManuallyEdited
    ? coerceCents(prev?.parkingPassWeeklyPriceCents)
    : nextDaily * 7;
  const nextMonthly = prev?._monthlyManuallyEdited
    ? coerceCents(prev?.parkingPassMonthlyPriceCents)
    : nextDaily * 30;

  return {
    ...prev,
    parkingPassDailyPriceCents: nextDaily,
    parkingPassWeeklyPriceCents: nextWeekly,
    parkingPassMonthlyPriceCents: nextMonthly,
  };
};

const buildGeocodeQuery = (host: any) => {
  const address = normalize(host?.address);
  const city = normalize(host?.city);
  const state = normalize(host?.state);
  if (!address) return "";

  const parts: string[] = [address];
  if (city && !includesLoose(address, city)) parts.push(city);
  if (state && !includesLoose(address, state)) parts.push(state);
  parts.push("USA");
  return parts.join(", ");
};

export default function HostLocationManager({
  canEdit = true,
}: HostLocationManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingHostId, setEditingHostId] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState({ lat: "", lng: "" });
  const [geocoding, setGeocoding] = useState(false);
  const [editingPricingHostId, setEditingPricingHostId] = useState<
    string | null
  >(null);
  const [pricingEdits, setPricingEdits] = useState<any>({
    parkingPassStartTime: "",
    parkingPassEndTime: "",
    parkingPassDaysOfWeek: [] as number[],
    parkingPassBreakfastPriceCents: 0,
    parkingPassLunchPriceCents: 0,
    parkingPassDinnerPriceCents: 0,
    parkingPassDailyPriceCents: 0,
    parkingPassWeeklyPriceCents: 0,
    parkingPassMonthlyPriceCents: 0,
    _dailyOnlySelected: false,
  });
  const dayLabels = useMemo(
    () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    [],
  );

  const { data: hosts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/hosts"],
  });

  const updateCoordinates = useMutation({
    mutationFn: async ({
      hostId,
      lat,
      lng,
    }: {
      hostId: string;
      lat: string;
      lng: string;
    }) => {
      return await apiRequest(
        "PATCH",
        `/api/admin/hosts/${hostId}/coordinates`,
        {
          latitude: lat,
          longitude: lng,
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/hosts"] });
      setEditingHostId(null);
      setCoordinates({ lat: "", lng: "" });
      toast({ title: "Success", description: "Host coordinates updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update coordinates",
        variant: "destructive",
      });
    },
  });

  const updateHostDefaults = useMutation({
    mutationFn: async (payload: { hostId: string; updates: any }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/hosts/${payload.hostId}`,
        payload.updates,
      );
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/hosts"] });
      setEditingPricingHostId(null);
      toast({ title: "Saved", description: "Parking Pass defaults updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description:
          error?.message || "Failed to update Parking Pass defaults.",
        variant: "destructive",
      });
    },
  });

  const geocodeHost = async (host: any) => {
    const query = buildGeocodeQuery(host);
    if (!query) {
      toast({
        title: "Error",
        description: "Host has no address",
        variant: "destructive",
      });
      return;
    }

    setGeocoding(true);
    try {
      const response = await fetch(apiUrl(`/api/location/search?limit=1&q=${encodeURIComponent(query)}`),
      );
      const data = await response.json();

      if (data && data.length > 0) {
        setCoordinates({ lat: data[0].lat, lng: data[0].lon });
        setEditingHostId(host.id);
        toast({
          title: "Success",
          description: "Address geocoded - click Update to save",
        });
      } else {
        toast({
          title: "Error",
          description: "Could not find coordinates",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to geocode address",
        variant: "destructive",
      });
    } finally {
      setGeocoding(false);
    }
  };

  if (isLoading) return <p>Loading hosts...</p>;

  return (
    <div className="space-y-3">
      {!canEdit && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          View-only access. Ask an admin to update coordinates.
        </div>
      )}
      {hosts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hosts found. Create one above!
        </p>
      ) : (
        hosts.map((host) => (
          <div key={host.id} className="p-3 border rounded-lg space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-medium">{host.businessName}</p>
                <p className="text-sm text-muted-foreground">
                  {normalize(host.address)}
                  {host.city &&
                  !includesLoose(normalize(host.address), host.city)
                    ? `, ${host.city}`
                    : ""}
                  {host.state &&
                  !includesLoose(normalize(host.address), host.state)
                    ? `, ${host.state}`
                    : ""}
                </p>
                {host?.rep && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Rep:{" "}
                    {`${host.rep.firstName || ""} ${host.rep.lastName || ""}`.trim() ||
                      host.rep.email ||
                      host.rep.id}{" "}
                    {host.rep.email ? `(${host.rep.email})` : ""}
                    {host.rep.phone ? ` ${host.rep.phone}` : ""}
                  </p>
                )}
                {host?.rep?.affiliateTag && (
                  <p className="text-xs text-muted-foreground">
                    Rep affiliate tag:{" "}
                    <span className="font-mono">{host.rep.affiliateTag}</span>
                  </p>
                )}
                {host?.rep?.referredByCloser && (
                  <p className="text-xs text-muted-foreground">
                    Rep referred by:{" "}
                    {`${host.rep.referredByCloser.firstName || ""} ${host.rep.referredByCloser.lastName || ""}`.trim() ||
                      host.rep.referredByCloser.email ||
                      host.rep.referredByCloser.id}
                    {host.rep.referredByCloser.affiliateTag
                      ? ` (ref=${host.rep.referredByCloser.affiliateTag})`
                      : ""}
                  </p>
                )}
                {host.latitude && host.longitude && (
                  <p className="text-xs text-[color:var(--status-success)] mt-1">
                    Coords: {host.latitude}, {host.longitude}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => geocodeHost(host)}
                  disabled={geocoding || !canEdit}
                >
                  {geocoding ? "..." : "Geocode"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setEditingPricingHostId(host.id);
                    const breakfast = coerceCents(
                      host.parkingPassBreakfastPriceCents,
                    );
                    const lunch = coerceCents(host.parkingPassLunchPriceCents);
                    const dinner = coerceCents(
                      host.parkingPassDinnerPriceCents,
                    );
                    const slotSum = breakfast + lunch + dinner;
                    const savedDaily = coerceCents(
                      host.parkingPassDailyPriceCents,
                    );
                    const initialDaily = savedDaily > 0 ? savedDaily : slotSum;
                    const dailyOnlySelected = slotSum === 0 && initialDaily > 0;
                    const savedWeekly = coerceCents(
                      host.parkingPassWeeklyPriceCents,
                    );
                    const savedMonthly = coerceCents(
                      host.parkingPassMonthlyPriceCents,
                    );
                    const derivedWeekly =
                      initialDaily > 0 ? initialDaily * 7 : 0;
                    const derivedMonthly =
                      initialDaily > 0 ? initialDaily * 30 : 0;
                    setPricingEdits({
                      parkingPassStartTime: host.parkingPassStartTime || "",
                      parkingPassEndTime: host.parkingPassEndTime || "",
                      parkingPassDaysOfWeek: Array.isArray(
                        host.parkingPassDaysOfWeek,
                      )
                        ? host.parkingPassDaysOfWeek
                        : [],
                      parkingPassBreakfastPriceCents: breakfast,
                      parkingPassLunchPriceCents: lunch,
                      parkingPassDinnerPriceCents: dinner,
                      parkingPassDailyPriceCents: initialDaily,
                      parkingPassWeeklyPriceCents:
                        savedWeekly > 0 ? savedWeekly : derivedWeekly,
                      parkingPassMonthlyPriceCents:
                        savedMonthly > 0 ? savedMonthly : derivedMonthly,
                      _dailyManuallyEdited:
                        savedDaily > 0 && slotSum > 0
                          ? savedDaily !== slotSum
                          : false,
                      _weeklyManuallyEdited:
                        savedWeekly > 0 && derivedWeekly > 0
                          ? savedWeekly !== derivedWeekly
                          : false,
                      _monthlyManuallyEdited:
                        savedMonthly > 0 && derivedMonthly > 0
                          ? savedMonthly !== derivedMonthly
                          : false,
                      _dailyOnlySelected: dailyOnlySelected,
                    });
                  }}
                  disabled={!canEdit}
                >
                  Edit pricing
                </Button>
              </div>
            </div>

            {editingHostId === host.id && canEdit && (
              <div className="pt-2 border-t space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Latitude"
                    value={coordinates.lat}
                    onChange={(e) =>
                      setCoordinates({ ...coordinates, lat: e.target.value })
                    }
                    className="px-2 py-1 border rounded text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Longitude"
                    value={coordinates.lng}
                    onChange={(e) =>
                      setCoordinates({ ...coordinates, lng: e.target.value })
                    }
                    className="px-2 py-1 border rounded text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      updateCoordinates.mutate({
                        hostId: host.id,
                        lat: coordinates.lat,
                        lng: coordinates.lng,
                      })
                    }
                    disabled={
                      !coordinates.lat ||
                      !coordinates.lng ||
                      updateCoordinates.isPending
                    }
                  >
                    Update
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingHostId(null);
                      setCoordinates({ lat: "", lng: "" });
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {editingPricingHostId === host.id && canEdit && (
              <div className="pt-2 border-t space-y-3">
                <div className="text-xs font-semibold text-muted-foreground">
                  Parking Pass defaults (host)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">
                      Start
                    </div>
                    <input
                      type="time"
                      value={pricingEdits.parkingPassStartTime}
                      onChange={(e) =>
                        setPricingEdits({
                          ...pricingEdits,
                          parkingPassStartTime: e.target.value,
                        })
                      }
                      className="px-2 py-1 border rounded text-sm w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">End</div>
                    <input
                      type="time"
                      value={pricingEdits.parkingPassEndTime}
                      onChange={(e) =>
                        setPricingEdits({
                          ...pricingEdits,
                          parkingPassEndTime: e.target.value,
                        })
                      }
                      className="px-2 py-1 border rounded text-sm w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">
                      Days
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {dayLabels.map((label, idx) => {
                        const days: number[] = Array.isArray(
                          pricingEdits.parkingPassDaysOfWeek,
                        )
                          ? pricingEdits.parkingPassDaysOfWeek
                          : [];
                        const checked = days.includes(idx);
                        return (
                          <label
                            key={label}
                            className="flex items-center gap-1 text-xs text-muted-foreground"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set<number>(days);
                                if (e.target.checked) next.add(idx);
                                else next.delete(idx);
                                setPricingEdits({
                                  ...pricingEdits,
                                  parkingPassDaysOfWeek: Array.from(next).sort(
                                    (a, b) => a - b,
                                  ),
                                });
                              }}
                            />
                            {label}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">
                      Breakfast ($)
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={toDollars(
                        pricingEdits.parkingPassBreakfastPriceCents,
                      )}
                      onChange={(e) => {
                        const cents = toCents(e.target.value);
                        setPricingEdits((prev: any) => {
                          const next = {
                            ...prev,
                            parkingPassBreakfastPriceCents: cents,
                            _dailyOnlySelected: false,
                          };
                          const sum =
                            coerceCents(cents) +
                            coerceCents(next?.parkingPassLunchPriceCents) +
                            coerceCents(next?.parkingPassDinnerPriceCents);
                          return applySlotSumToDailyIfAuto(next, sum);
                        });
                      }}
                      className="px-2 py-1 border rounded text-sm w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">
                      Lunch ($)
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={toDollars(pricingEdits.parkingPassLunchPriceCents)}
                      onChange={(e) => {
                        const cents = toCents(e.target.value);
                        setPricingEdits((prev: any) => {
                          const next = {
                            ...prev,
                            parkingPassLunchPriceCents: cents,
                            _dailyOnlySelected: false,
                          };
                          const sum =
                            coerceCents(next?.parkingPassBreakfastPriceCents) +
                            coerceCents(cents) +
                            coerceCents(next?.parkingPassDinnerPriceCents);
                          return applySlotSumToDailyIfAuto(next, sum);
                        });
                      }}
                      className="px-2 py-1 border rounded text-sm w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">
                      Dinner ($)
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={toDollars(
                        pricingEdits.parkingPassDinnerPriceCents,
                      )}
                      onChange={(e) => {
                        const cents = toCents(e.target.value);
                        setPricingEdits((prev: any) => {
                          const next = {
                            ...prev,
                            parkingPassDinnerPriceCents: cents,
                            _dailyOnlySelected: false,
                          };
                          const sum =
                            coerceCents(next?.parkingPassBreakfastPriceCents) +
                            coerceCents(next?.parkingPassLunchPriceCents) +
                            coerceCents(cents);
                          return applySlotSumToDailyIfAuto(next, sum);
                        });
                      }}
                      className="px-2 py-1 border rounded text-sm w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">
                      Daily ($)
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={toDollars(pricingEdits.parkingPassDailyPriceCents)}
                      onChange={(e) => {
                        const cents = toCents(e.target.value);
                        const nextWeekly = pricingEdits._weeklyManuallyEdited
                          ? coerceCents(
                              pricingEdits.parkingPassWeeklyPriceCents,
                            )
                          : cents * 7;
                        const nextMonthly = pricingEdits._monthlyManuallyEdited
                          ? coerceCents(
                              pricingEdits.parkingPassMonthlyPriceCents,
                            )
                          : cents * 30;
                        setPricingEdits({
                          ...pricingEdits,
                          parkingPassDailyPriceCents: cents,
                          parkingPassWeeklyPriceCents: nextWeekly,
                          parkingPassMonthlyPriceCents: nextMonthly,
                          _dailyManuallyEdited: cents > 0,
                        });
                      }}
                      className="px-2 py-1 border rounded text-sm w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">
                      Weekly ($)
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={toDollars(
                        pricingEdits.parkingPassWeeklyPriceCents,
                      )}
                      onChange={(e) => {
                        const cents = toCents(e.target.value);
                        setPricingEdits({
                          ...pricingEdits,
                          parkingPassWeeklyPriceCents: cents,
                          _weeklyManuallyEdited: cents > 0,
                        });
                      }}
                      className="px-2 py-1 border rounded text-sm w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">
                      Monthly ($)
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={toDollars(
                        pricingEdits.parkingPassMonthlyPriceCents,
                      )}
                      onChange={(e) => {
                        const cents = toCents(e.target.value);
                        setPricingEdits({
                          ...pricingEdits,
                          parkingPassMonthlyPriceCents: cents,
                          _monthlyManuallyEdited: cents > 0,
                        });
                      }}
                      className="px-2 py-1 border rounded text-sm w-full"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(pricingEdits._dailyOnlySelected)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const breakfast = coerceCents(
                        pricingEdits.parkingPassBreakfastPriceCents,
                      );
                      const lunch = coerceCents(
                        pricingEdits.parkingPassLunchPriceCents,
                      );
                      const dinner = coerceCents(
                        pricingEdits.parkingPassDinnerPriceCents,
                      );
                      const slotSum = breakfast + lunch + dinner;
                      if (checked && slotSum > 0) {
                        toast({
                          title: "Daily-only conflicts with slots",
                          description:
                            "Clear Breakfast/Lunch/Dinner prices before enabling Daily only.",
                          variant: "destructive",
                        });
                        return;
                      }
                      setPricingEdits({
                        ...pricingEdits,
                        _dailyOnlySelected: checked,
                        ...(checked ? { _dailyManuallyEdited: false } : null),
                      });
                    }}
                  />
                  Daily only (this host allows all-day parking, no time-slot
                  pricing)
                </label>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      updateHostDefaults.mutate({
                        hostId: host.id,
                        updates: {
                          parkingPassStartTime:
                            pricingEdits.parkingPassStartTime || null,
                          parkingPassEndTime:
                            pricingEdits.parkingPassEndTime || null,
                          parkingPassDaysOfWeek: Array.isArray(
                            pricingEdits.parkingPassDaysOfWeek,
                          )
                            ? pricingEdits.parkingPassDaysOfWeek
                            : [],
                          parkingPassDailyOnly: Boolean(
                            pricingEdits._dailyOnlySelected,
                          ),
                          parkingPassBreakfastPriceCents: Number(
                            pricingEdits.parkingPassBreakfastPriceCents || 0,
                          ),
                          parkingPassLunchPriceCents: Number(
                            pricingEdits.parkingPassLunchPriceCents || 0,
                          ),
                          parkingPassDinnerPriceCents: Number(
                            pricingEdits.parkingPassDinnerPriceCents || 0,
                          ),
                          parkingPassDailyPriceCents: Number(
                            pricingEdits.parkingPassDailyPriceCents || 0,
                          ),
                          parkingPassWeeklyPriceCents: Number(
                            pricingEdits.parkingPassWeeklyPriceCents || 0,
                          ),
                          parkingPassMonthlyPriceCents: Number(
                            pricingEdits.parkingPassMonthlyPriceCents || 0,
                          ),
                        },
                      });
                    }}
                    disabled={updateHostDefaults.isPending}
                  >
                    {updateHostDefaults.isPending
                      ? "Saving..."
                      : "Save pricing"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingPricingHostId(null)}
                    disabled={updateHostDefaults.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
