import type { ReactNode } from "react";

export function ActiveScenePanel({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative z-20 -mt-7 rounded-t-[2rem] border-t border-[#ead8c7] bg-[linear-gradient(180deg,rgba(255,251,246,0.985)_0%,rgba(255,248,240,0.995)_20rem,#fffaf5_100%)] pt-2 shadow-[0_-18px_48px_rgba(79,45,25,0.16)] backdrop-blur-md"
      data-scout-results-surface="integrated"
    >
      {/* Drag handle pill */}
      <div
        aria-hidden="true"
        className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-[#d89a73]/65"
      />
      {children}
    </div>
  );
}
