import { useMemo } from "react";
import { useLocation } from "wouter";
import EventsPage from "@/pages/events";
import EventsPublicHub from "@/pages/events-public-hub";

export default function EventsRouter() {
  const [location] = useLocation();
  const mode = useMemo(() => {
    const query = location.includes("?") ? location.split("?")[1] : "";
    return new URLSearchParams(query).get("mode");
  }, [location]);

  if (mode === "manage") {
    return <EventsPage />;
  }

  return <EventsPublicHub />;
}
