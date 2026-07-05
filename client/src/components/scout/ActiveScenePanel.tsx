import type { ReactNode } from "react";

export function ActiveScenePanel({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-20 -mt-1 rounded-t-[1.35rem] border-t border-orange-100/12 bg-[#1c130c]/88 pt-1 shadow-[0_-24px_48px_rgba(0,0,0,0.34)] backdrop-blur-md">
      {/* Drag handle pill */}
      <div
        aria-hidden="true"
        className="mx-auto mb-2 h-[3px] w-10 rounded-full bg-white/20"
      />
      {children}
    </div>
  );
}
