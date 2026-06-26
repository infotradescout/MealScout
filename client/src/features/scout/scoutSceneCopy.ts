import type { ScoutSceneCopy, ScoutSceneId } from "./scoutTypes";

export const SCOUT_SCENE_COPY: Record<ScoutSceneId, ScoutSceneCopy> = {
  for_you: {
    title: "For You",
    subtitle: "Open now, trending this week, and worth trying near you.",
  },
  community: {
    title: "Community Picks",
    subtitle: "What locals are saving, sharing, and coming back to.",
  },
  nearby_now: {
    title: "Open Now",
    subtitle: "Food, drinks, events, and trucks close to you right now.",
  },
  food_trucks: {
    title: "Food Trucks Today",
    subtitle: "Trucks posted up, scheduled, or serving nearby today.",
  },
  restaurants: {
    title: "Nearby Restaurants",
    subtitle: "Open tables, local kitchens, and menu highlights.",
  },
  deals: {
    title: "Hot Deals",
    subtitle: "Active offers from nearby spots.",
  },
  events: {
    title: "Events & Pop-Ups",
    subtitle: "Food, music, pop-ups, and things happening around town.",
  },
  new_menus: {
    title: "New Menus",
    subtitle: "Fresh dishes and menu updates from local spots.",
  },
  late_night: {
    title: "Late Night",
    subtitle: "Places still serving after hours.",
  },
  worth_discovering: {
    title: "Worth Discovering",
    subtitle: "New, quiet, or under-scouted spots nearby.",
  },
};
