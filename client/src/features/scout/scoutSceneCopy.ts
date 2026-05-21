import type { ScoutSceneCopy, ScoutSceneId } from "./scoutTypes";

export const SCOUT_SCENE_COPY: Record<ScoutSceneId, ScoutSceneCopy> = {
  for_you: {
    title: "For You",
    subtitle: "Local favorites, open spots, new menus, and places worth finding.",
  },
  community: {
    title: "Community",
    subtitle: "What locals are saving, sharing, and coming back to.",
  },
  nearby_now: {
    title: "Nearby",
    subtitle: "Food, drinks, events, and trucks close to you.",
  },
  food_trucks: {
    title: "Food Trucks",
    subtitle: "Trucks posted up, scheduled, or serving nearby.",
  },
  restaurants: {
    title: "Restaurants",
    subtitle: "Open tables, local kitchens, and menu highlights.",
  },
  deals: {
    title: "Deals",
    subtitle: "Active offers from nearby spots.",
  },
  events: {
    title: "Events",
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
