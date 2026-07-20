import type { ReactNode } from "react";

export function ActiveScenePanel({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-20 -mt-10 rounded-t-[1.25rem] border-t border-orange-200/20 bg-[linear-gradient(180deg,rgba(57,35,23,0.985)_0%,rgba(42,26,18,0.992)_18rem,rgba(28,20,15,0.998)_100%)] pt-1 shadow-[0_-16px_38px_rgba(0,0,0,0.34)] backdrop-blur-md">
      {/* Drag handle pill */}
      <div
        aria-hidden="true"
        className="mx-auto mb-1.5 h-[3px] w-9 rounded-full bg-orange-200/42"
      />
      {children}
    </div>
  );
}
