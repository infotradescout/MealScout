import type { ReactNode } from "react";

export function ActiveScenePanel({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-20 -mt-1 rounded-t-[1.35rem] border-t border-orange-200/70 bg-[linear-gradient(180deg,rgba(255,248,236,0.98)_0%,rgba(255,253,248,0.99)_22rem,rgba(255,247,232,0.99)_100%)] pt-1 shadow-[0_-12px_30px_rgba(112,64,28,0.12)] backdrop-blur-md">
      {/* Drag handle pill */}
      <div
        aria-hidden="true"
        className="mx-auto mb-2 h-[3px] w-10 rounded-full bg-orange-300/70"
      />
      {children}
    </div>
  );
}
