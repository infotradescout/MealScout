import type { ReactNode } from "react";

export function ScoutMapHero({ children }: { children: ReactNode }) {
  return <div className="relative z-10">{children}</div>;
}
