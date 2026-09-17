import { useEffect, useRef } from "react";
import { writeScoutJourney, type ScoutJourney } from "@/lib/scout-journey-state";

export function useScoutJourneyPersistence(account: string | null, value: ScoutJourney, restoredScroll = 0) {
  const latest = useRef(value);
  latest.current = value;
  const scroll = useRef(restoredScroll);
  useEffect(() => {
    if (!account) return;
    let restoring = restoredScroll > 0;
    let attempts = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stopRestore = () => { restoring = false; if (timer) clearInterval(timer); };
    const rememberScroll = () => { if (!restoring) scroll.current = Math.max(0, window.scrollY); };
    const save = () => writeScoutJourney(account, { ...latest.current, scrollY: scroll.current });
    const visibility = () => { if (document.visibilityState === "hidden") save(); };
    if (restoring) {
      timer = setInterval(() => {
        attempts += 1;
        const room = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (room >= restoredScroll || attempts >= 60) {
          stopRestore();
          window.scrollTo({ top: Math.min(restoredScroll, room), behavior: "instant" });
          rememberScroll();
        }
      }, 50);
    }
    window.addEventListener("scroll", rememberScroll, { passive: true });
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("wheel", stopRestore, { passive: true });
    window.addEventListener("pointerdown", stopRestore, { passive: true });
    window.addEventListener("keydown", stopRestore);
    return () => {
      save(); stopRestore();
      window.removeEventListener("scroll", rememberScroll);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("wheel", stopRestore);
      window.removeEventListener("pointerdown", stopRestore);
      window.removeEventListener("keydown", stopRestore);
    };
  }, [account, restoredScroll]);
  useEffect(() => {
    const timer = setTimeout(() => writeScoutJourney(account, { ...latest.current, scrollY: scroll.current }), 250);
    return () => clearTimeout(timer);
  }, [account, value]);
}
