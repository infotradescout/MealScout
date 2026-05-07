# Admin Dashboard Atmospheric Redesign Plan

## Goal
Redesign the Admin Dashboard with the MealScout atmospheric UI (dark mode, glassmorphism, amber accents) while preserving 100% of existing functionality, data fetching, and role-based logic.

## Design Principles
- **Atmospheric UI:** Permanent dark background (`bg-background` which is dark), glassmorphism effects (`backdrop-blur`, `bg-card/50`), and glowing amber accents (`text-primary`, `bg-primary`, `shadow-[0_0_15px_rgba(245,158,11,0.3)]`).
- **Typography:** Playfair Display for main section headers, clean sans-serif for data and controls.
- **Hierarchy:** Maintain the existing 4-card stats summary at the top, followed by the large tabbed interface.
- **Functionality First:** Do NOT remove any tabs, buttons, forms, or data displays. Only restyle them.

## Component Adaptation
1.  **Main Layout:**
    - Wrap in a dark, immersive container.
    - Ensure `Navigation` is kept at the top.
    - Add a Playfair Display headline: "Admin Control Center".

2.  **Stat Cards:**
    - Use glassmorphism cards.
    - Add a subtle amber glow to the icons.
    - Use high-contrast white/amber for primary metrics.

3.  **Tabs Interface:**
    - Restyle `TabsList` to be a floating glass bar.
    - Use amber underline or background for active tabs.

4.  **Tables and Lists:**
    - Use semi-transparent row backgrounds.
    - Ensure high readability with muted foreground colors for labels and bright colors for values.

5.  **Forms and Buttons:**
    - Buttons should be amber (`bg-primary`) with dark text.
    - Inputs should have subtle borders and dark backgrounds.

## Implementation Steps
1.  Modify `admin-dashboard.tsx` to include the new styling classes.
2.  Use Tailwind's `backdrop-blur-md` and `bg-opacity` utilities.
3.  Ensure `Navigation` component is untouched to preserve all role-based links.
4.  Test all tabs (Overview, Users, Restaurants, Deals, etc.) to ensure data loading still works.
