import type { ReactNode } from "react";

export function ActiveScenePanel({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-20 -mt-1 rounded-t-[1.35rem] border-t border-orange-200/24 bg-[#2f1d13]/88 pt-1 shadow-[0_-18px_38px_rgba(74,35,14,0.24)] backdrop-blur-md">
      {/* Drag handle pill */}
      <div
        aria-hidden="true"
        className="mx-auto mb-2 h-[3px] w-10 rounded-full bg-orange-200/42"
      />
      {children}
    </div>
  );
}
