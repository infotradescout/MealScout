import { useEffect, useState } from "react";

function computeIsStandalone() {
  try {
    const anyNav = navigator as any;
    const match = window.matchMedia?.("(display-mode: standalone)")?.matches;
    return Boolean(match || anyNav.standalone);
  } catch {
    return false;
  }
}

export function useIsStandalone() {
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsStandalone(computeIsStandalone());

    const mql = window.matchMedia?.("(display-mode: standalone)");
    const onChange = () => setIsStandalone(computeIsStandalone());
    const onInstalled = () => setIsStandalone(true);

    // `appinstalled` is supported in Chromium-based browsers.
    window.addEventListener("appinstalled", onInstalled);

    if (mql) {
      try {
        // Modern browsers
        mql.addEventListener("change", onChange);
        return () => {
          window.removeEventListener("appinstalled", onInstalled);
          mql.removeEventListener("change", onChange);
        };
      } catch {
        // Older Safari/WebKit
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mql as any).addListener?.(onChange);
        return () => {
          window.removeEventListener("appinstalled", onInstalled);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (mql as any).removeListener?.(onChange);
        };
      }
    }

    return () => {
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return isStandalone;
}

