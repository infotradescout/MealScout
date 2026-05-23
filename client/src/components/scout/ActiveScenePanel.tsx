import type { ReactNode } from "react";

export function ActiveScenePanel({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-20 -mt-1 rounded-t-[1.35rem] border-t border-white/10 bg-[#09080b]/88 pt-2 shadow-[0_-24px_48px_rgba(0,0,0,0.34)] backdrop-blur-md">
      {children}
    </div>
  );
}
