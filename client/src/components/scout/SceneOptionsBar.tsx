import { useEffect, useRef } from "react";
import type { ScoutSceneId, ScoutSceneLane } from "@/features/scout/scoutTypes";

export function SceneOptionsBar({
  lanes,
  activeSceneLaneId,
  onSceneLaneSelect,
  renderIcon,
}: {
  lanes: ScoutSceneLane[];
  activeSceneLaneId: ScoutSceneId;
  onSceneLaneSelect: (laneId: ScoutSceneId) => void;
  renderIcon: (icon: ScoutSceneLane["icon"]) => React.ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollerRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, []);

  return (
    <section className="px-3 pb-3 pt-1">
      <div ref={scrollerRef} className="overflow-x-auto atmo-hide-scrollbar pl-0.5">
        <div className="flex w-max gap-2 pr-2">
          {lanes.map((lane) => {
            const isActive = lane.id === activeSceneLaneId;
            return (
              <button
                key={lane.id}
                type="button"
                onClick={() => onSceneLaneSelect(lane.id)}
                className={[
                  "inline-flex min-h-10 min-w-[78px] shrink-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[11px] font-semibold ring-1 transition-colors active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/60",
                  isActive
                    ? "bg-[#ff6a2d] text-white ring-orange-200/35 shadow-[0_14px_28px_rgba(255,106,45,0.30)]"
                    : "bg-[#121317]/85 text-white/80 ring-white/10 hover:bg-[#171a23] hover:text-white",
                ].join(" ")}
                aria-pressed={isActive}
              >
                {renderIcon(lane.icon)}
                <span className="whitespace-nowrap">{lane.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
