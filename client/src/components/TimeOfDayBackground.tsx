import { useEffect } from "react";

// Dark mode is permanent and global — no light mode, no toggles, no time-based switching.
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
        }}
      />
      <div
        className="fixed inset-0 z-[1] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(8, 8, 8, 0.75) 0%, rgba(8, 8, 8, 0.55) 50%, rgba(8, 8, 8, 0.7) 100%)",
        }}
      />
    </>
  );
}

