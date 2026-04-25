import { useEffect, useState } from "react";

type ThemeMode = "day" | "night";

const DAY_START_HOUR = 6;
const NIGHT_START_HOUR = 16;

const getThemeMode = (): ThemeMode => {
  const hour = new Date().getHours();
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? "day" : "night";
};

export function TimeOfDayBackground() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "day";
    return getThemeMode();
  });

  useEffect(() => {
    const applyTheme = () => {
      const nextMode = getThemeMode();
      setMode(nextMode);
      const root = document.documentElement;
      root.classList.remove("theme-day", "theme-night");
      root.classList.add(`theme-${nextMode}`);
    };

    applyTheme();
    const interval = window.setInterval(applyTheme, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  const isDay = mode === "day";

  return (
    <>
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundColor: isDay ? "#FAFAF8" : "#1C1A18",
          backgroundImage: isDay
            ? "url('/backgrounds/food-truck-day.jpg')"
            : "url('/backgrounds/food-truck-night.png')",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: isDay ? "blur(6px)" : "none",
          transform: isDay ? "scale(1.01)" : "none",
        }}
      />
      <div
        className="fixed inset-0 z-[1] pointer-events-none"
        style={{
          backgroundColor: "transparent",
          backgroundImage: isDay
            ? "linear-gradient(180deg, rgba(250, 250, 248, 0.55) 0%, rgba(250, 250, 248, 0.72) 50%, rgba(250, 250, 248, 0.62) 100%)"
            : "linear-gradient(180deg, rgba(8, 8, 8, 0.75) 0%, rgba(8, 8, 8, 0.55) 50%, rgba(8, 8, 8, 0.7) 100%)",
        }}
      />
    </>
  );
}

