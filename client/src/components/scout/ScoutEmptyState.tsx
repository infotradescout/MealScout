import { Link } from "wouter";
import type { ScoutSceneId } from "@/features/scout/scoutTypes";

export function ScoutEmptyState({ laneId }: { laneId: ScoutSceneId }) {
  const isForYou = laneId === "for_you";
  const title = isForYou
    ? "The local board is quiet right now."
    : laneId === "community"
      ? "No local favorites nearby yet."
      : laneId === "deals"
        ? "No active deals nearby right now."
        : laneId === "food_trucks"
          ? "No trucks posted up nearby right now."
          : laneId === "events"
            ? "No food events nearby right now."
            : "Nothing strong here yet.";
  const body = isForYou
    ? "Try Worth Discovering, New Menus, or widen your area."
    : laneId === "community"
      ? "Explore nearby and save spots to build your local favorites."
      : laneId === "deals"
        ? "Try Nearby or New Menus for fresh local options."
        : laneId === "food_trucks"
          ? "Try Restaurants, Events, or Worth Discovering."
          : laneId === "events"
            ? "Check Nearby or Worth Discovering."
            : "Try another scene or widen your area.";

  return (
    <section className="px-4 pb-4">
      <div className="rounded-2xl bg-white/[0.04] px-4 py-3 text-white ring-1 ring-white/10">
        <p className="text-sm font-black">{title}</p>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-white/58">{body}</p>
        {isForYou ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/search" className="rounded-full bg-[#ff7945] px-3 py-1.5 text-[11px] font-black text-white ring-1 ring-white/20">Widen Area</Link>
            <Link href="/search?q=worth%20discovering" className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-black text-white/90 ring-1 ring-white/16">Worth Discovering</Link>
            <Link href="/search?q=new%20menus" className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-black text-white/90 ring-1 ring-white/16">New Menus</Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
