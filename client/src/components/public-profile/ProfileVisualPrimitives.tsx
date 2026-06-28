import type { ReactNode } from "react";

export const profileSurfaceClass =
  "overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#100b08]/92 shadow-[0_22px_70px_rgba(0,0,0,0.48)]";

export const profileRailScrollerClass =
  "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 scrollbar-none";

export function ProfileSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-100/52">
      {children}
    </p>
  );
}

export function ProfilePill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "orange" | "green";
}) {
  const toneClass =
    tone === "orange"
      ? "border-orange-300/30 bg-orange-500/12 text-orange-100"
      : tone === "green"
        ? "border-emerald-300/25 bg-emerald-500/10 text-emerald-100"
        : "border-white/12 bg-white/[0.055] text-white/68";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${toneClass}`}
    >
      {children}
    </span>
  );
}
