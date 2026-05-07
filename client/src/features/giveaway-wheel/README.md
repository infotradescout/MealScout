# Giveaway Wheel Module

Reusable game-show giveaway wheel used by the MealScout admin giveaway page.

## Current Boundary

- `GiveawayWheelExperience.tsx` owns wheel state, list parsing, spin timing, sounds, winner reveal, record mode, upload, shuffle, and reset.
- `giveaway-wheel.css` owns the full wheel/stage presentation.
- `index.ts` exports the component, config types, parser, defaults, and module version.
- `client/src/pages/admin-giveaway-wheel.tsx` is now only the MealScout wrapper/config.

## Basic Use

```tsx
import { GiveawayWheelExperience, type GiveawayWheelConfig } from "@/features/giveaway-wheel";

const config: GiveawayWheelConfig = {
  productName: "Brand Giveaway",
  defaultTitle: "Brand Giveaway",
  defaultEntries: ["Alex", "Sam", "Jordan"],
  background: {
    imageUrl: "/backgrounds/show-stage.png",
    noiseUrl: "/backgrounds/noise.png",
  },
  logo: {
    src: "/brand/logo-for-wheel.svg",
    alt: "Brand",
  },
  theme: {
    wheelColors: ["#f59e0b", "#14b8a6", "#ef4444", "#2563eb"],
    stageGold: "#f59e0b",
    stageRed: "#ef4444",
  },
};

export function GiveawayPage() {
  return (
    <GiveawayWheelExperience
      backHref="/admin"
      backLabel="Admin"
      config={config}
      storageKey="brand-giveaway-wheel-v1"
    />
  );
}
```

## Logo Rule

The wheel module does not patch logo artwork. If a brand mark needs a filled interior, ship a wheel-ready logo asset with that fill baked into the SVG or PNG. MealScout uses `/brand/logo-mark-wheel.svg` for that reason.

## Standalone Product Path

Next extraction steps:

1. Move shared UI controls behind small adapter props so the module no longer depends on MealScout's shadcn components.
2. Package the feature as a Vite-powered standalone app shell.
3. Add import/export presets for giveaway lists, brand themes, logos, backgrounds, and sound packs.
4. Add versioned config migration so saved wheels can update without breaking existing campaigns.
