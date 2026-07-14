import type { ReactNode } from "react";

export function ActiveScenePanel({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-20 -mt-1 rounded-t-[1.35rem] border-t border-orange-200/30 bg-[linear-gradient(180deg,rgba(68,39,22,0.96)_0%,rgba(49,28,17,0.97)_22rem,rgba(31,18,12,0.98)_100%)] pt-1 shadow-[0_-18px_38px_rgba(74,35,14,0.28)] backdrop-blur-md">
      {/* Drag handle pill */}
      <div
        aria-hidden="true"
        className="mx-auto mb-2 h-[3px] w-10 rounded-full bg-orange-200/42"
      />
      {children}
    </div>
  );
}
