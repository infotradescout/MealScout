import { useEffect } from "react";

export function TimeOfDayBackground() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-day", "theme-night");
    root.classList.add("theme-night");
  }, []);

  return (
    <>
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundColor: "#1C1A18",
          backgroundImage: "url('/backgrounds/food-truck-night.png')",
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
          backgroundImage: "linear-gradient(180deg, rgba(8, 8, 8, 0.74) 0%, rgba(8, 8, 8, 0.62) 50%, rgba(8, 8, 8, 0.72) 100%)",
        }}
      />
    </>
  );
}

