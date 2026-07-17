import { useEffect } from "react";

type AppBackgroundAppearance = "day" | "night";

export function TimeOfDayBackground({
  appearance = "day",
}: {
  appearance?: AppBackgroundAppearance;
}) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-day", "theme-night");
    root.classList.add(appearance === "night" ? "theme-night" : "theme-day");
  }, [appearance]);

  if (appearance === "day") {
    return (
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{ background: "var(--bg-layered)" }}
        aria-hidden="true"
      />
    );
  }

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
        aria-hidden="true"
      />
    </>
  );
}

