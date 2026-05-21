import { SCOUT_SCENE_COPY } from "@/features/scout/scoutSceneCopy";
import type { ScoutSceneId } from "@/features/scout/scoutTypes";

export function ActiveSceneIntro({ laneId }: { laneId: ScoutSceneId }) {
  const activeCopy = SCOUT_SCENE_COPY[laneId] ?? SCOUT_SCENE_COPY.for_you;
  return (
    <section className="px-4 pb-3">
      <h2 className="font-sans text-2xl font-semibold tracking-tight text-white">{activeCopy.title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-white/62">{activeCopy.subtitle}</p>
    </section>
  );
}
