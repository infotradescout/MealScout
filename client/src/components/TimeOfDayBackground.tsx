import { useEffect } from "react";
import { isMetaInAppBrowser } from "@/lib/inAppBrowser";

export function TimeOfDayBackground() {
  const useLightweightBackground =
    typeof navigator !== "undefined" && isMetaInAppBrowser(navigator.userAgent);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-day", "theme-night");
    root.classList.add("theme-night");
  }, []);

  if (useLightweightBackground) {
    return (
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundColor: "#1C1A18",
          backgroundImage:
            "linear-gradient(180deg, #161310 0%, #1c1a18 48%, #111111 100%)",
        }}
      />
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundColor: "#1C1A18",
          backgroundImage: "url('/backgrounds/food-truck-night.jpg')",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "saturate(1.05) contrast(1.03)",
          transform: "none",
          opacity: 0.72,
        }}
      />
      <div
        className="fixed inset-0 z-[1] pointer-events-none"
        style={{
          backgroundColor: "transparent",
          backgroundImage:
            "linear-gradient(180deg, rgba(8, 8, 8, 0.74) 0%, rgba(8, 8, 8, 0.62) 50%, rgba(8, 8, 8, 0.72) 100%)",
        }}
      />
    </>
  );
}
