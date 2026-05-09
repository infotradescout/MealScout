import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

export default function ParkingPassManage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!user) {
      setLocation(
        `/login?redirect=${encodeURIComponent("/parking-pass?setup=host")}`,
      );
      return;
    }

    let cancelled = false;
    fetch("/api/hosts/me", { credentials: "include" })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setLocation("/parking-pass?setup=host");
        } else {
          setLocation("/parking-pass?setup=host");
        }
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



