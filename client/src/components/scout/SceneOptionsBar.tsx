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
    <section className="px-4 pb-4">
      <div ref={scrollerRef} className="overflow-x-auto atmo-hide-scrollbar pl-0.5">
        <div className="flex w-max gap-1 pr-2">
          {lanes.map((lane) => {
            const isActive = lane.id === activeSceneLaneId;
            return (
              <button
                key={lane.id}
                type="button"
                onClick={() => onSceneLaneSelect(lane.id)}
                className={[
                  "inline-flex min-h-11 min-w-[76px] shrink-0 items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-bold ring-1 transition-colors active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/60",
                  isActive
                    ? "bg-[#ff7945] text-white ring-white/20 shadow-[0_10px_22px_rgba(255,121,69,0.28)]"
                    : "bg-[#11131a]/82 text-white/78 ring-white/12 hover:bg-[#171a23] hover:text-white",
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
