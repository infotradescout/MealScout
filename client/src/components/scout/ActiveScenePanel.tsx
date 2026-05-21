import type { ReactNode } from "react";

export function ActiveScenePanel({ children }: { children: ReactNode }) {
  return <div className="relative z-10 mt-4">{children}</div>;
}
