import type { ReactNode } from "react";

export function ActiveScenePanel({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-20 -mt-10 rounded-t-[1.25rem] border-t border-[color:var(--border-subtle)] bg-[var(--bg-popup)] pt-1 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] backdrop-blur-md">
      {/* Drag handle pill */}
      <div
        aria-hidden="true"
        className="mx-auto mb-1.5 h-[3px] w-9 rounded-full bg-[color:var(--border-strong,rgba(0,0,0,0.16))]"
      />
      {children}
    </div>
  );
}
