import {
  GiveawayWheelExperience,
  type GiveawayWheelConfig,
} from "@/features/giveaway-wheel";

const mealScoutGiveawayConfig: GiveawayWheelConfig = {
  productName: "MealScout Giveaway",
  defaultTitle: "MealScout Giveaway",
  defaultEntries: [
    "Food Truck Fan 01",
    "Food Truck Fan 02",
    "Food Truck Fan 03",
    "Food Truck Fan 04",
    "Food Truck Fan 05",
    "Food Truck Fan 06",
    "Food Truck Fan 07",
    "Food Truck Fan 08",
  ],
  background: {
    imageUrl: "/backgrounds/food-truck-night.png",
    noiseUrl: "/backgrounds/noise.png",
  },
  logo: {
    src: "/brand/logo-mark-wheel.svg",
    alt: "MealScout",
  },
  theme: {
    stageGold: "#f59e0b",
    stageRed: "#ef4444",
    stageTeal: "#14b8a6",
    stageInk: "#070605",
  },
};

export default function AdminGiveawayWheel() {
  return (
    <GiveawayWheelExperience
      backHref="/admin"
      backLabel="Admin"
      config={mealScoutGiveawayConfig}
      storageKey="mealscout-giveaway-wheel-v1"
    />
  );
}

