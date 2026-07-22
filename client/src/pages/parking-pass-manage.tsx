import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { isTruckBusinessType } from "@shared/businessTypes";

export default function ParkingPassManage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const requestedPath = `${window.location.pathname}${window.location.search}`;
    if (!user) {
      setLocation(
        `/login?redirect=${encodeURIComponent(requestedPath)}`,
      );
      return;
    }

    let cancelled = false;
    fetch("/api/restaurants/my-restaurants", { credentials: "include" })
      .then(async (res) => {
        if (cancelled) return;
        const rows = res.ok ? await res.json().catch(() => []) : [];
        const trucks = Array.isArray(rows)
          ? rows.filter(
              (row: any) =>
                row?.isFoodTruck === true ||
                isTruckBusinessType(row?.businessType),
            )
          : [];
        const requestedTruckId = String(
          new URLSearchParams(window.location.search).get("truckId") || "",
        ).trim();
        const selectedTruck =
          trucks.find((row: any) => String(row.id) === requestedTruckId) ||
          trucks[0];
        setLocation(
          selectedTruck
            ? `/parking-pass?setup=schedule&truckId=${encodeURIComponent(String(selectedTruck.id))}`
            : "/parking-pass?setup=host",
        );
      })
      .catch(() => {
        if (cancelled) return;
        setLocation("/parking-pass?setup=host");
      });

    return () => {
      cancelled = true;
    };
  }, [user, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      Redirecting to your parking pass experience...
    </div>
  );
}
