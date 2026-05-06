# /explore mobile — exact specs from approved mockup

Reference: /home/ubuntu/MealScout_dashboard_reference_match.png (1054 x 1406)

## Top bar (overlaid on hero photo, NOT in a separate band)
- Left: circular avatar (~56px) of the logged-in user
- Center: glass pill chip showing location with pin icon + city name + chevron
- Right: circular glass search button (~56px)
- Padding: 24px from sides, ~16px from top safe area
- All three sit ON the photo, no header background

## Brand eyebrow
- Text: MEALSCOUT
- Tracking: very wide (~0.32em)
- Size: 11-12px
- Weight: medium
- Color: pure white, low opacity (~0.85)
- Position: left, ~16px below the top bar, ~24px from left edge
- NO logo lockup, just the wordmark

## Headline
- Two lines:
  - "Good evening,"   <- comma at end, NOT a period
  - "Thomas."         <- name + period (or "Welcome." if no user)
- Font: Playfair Display (or similar editorial serif), extra bold
- Size: ~64px on this 1054px viewport (so ~52-56px on 430px iPhone)
- Color: pure white
- Line height: ~0.95 (very tight)
- Position: left aligned, full natural width (no wrap on "Good evening,")
- Text shadow: soft dark (0 2px 28px rgba(0,0,0,0.65)) for legibility on photo

## Sub-line
- Text: "Your local scene." in mockup — REPLACED PROJECT-WIDE WITH "Follow The Flavor."
- Size: ~16-18px
- Color: white at 90% opacity
- Position: directly below headline with ~12px gap
- NOT italic in mockup — keep upright

## Hero photo
- Full bleed, top of page to ~just past the CTA button bottom
- Subject: dark food-park night scene with The Yard signage on right, string lights, crowd, wet pavement reflections
- Gradient overlay: very subtle on top (so headline reads), strong amber-tinted dark fade at bottom (so CTA glow pops, content below is true black)
- The photo is a single image, NOT split by a black band in the middle

## "Explore the Map" CTA (THE hero of the page)
- Position: left-aligned, ~24px from left edge, sits ON the photo (not below it)
- Width: ~85% of viewport width (NOT full bleed)
- Height: ~64px
- Shape: full pill (rounded-full)
- Background: very dark transparent (#0a0a0a at ~70-80% over the photo)
- Border: 2px solid amber (#f59e0b) ~ ALL the way around, glowing
- Glow: substantial amber drop shadow + outer glow
- Inside, left: small amber circular icon disc (~40px) with navigation/compass icon
- Inside, center-ish: text "Explore the Map" in amber-cream color, ~18-20px, semibold

## Section break
- Photo ends, page becomes solid #0a0c10 (true black)
- 32px gap before next section

## "Explore by Craving" section (CRITICAL — was wrong on live site)
- Section header: "Explore by Craving" left, "See All >" right (amber)
- 6 circular bubbles in a HORIZONTAL row (not 4)
- Each bubble: circular real food photo (~96px diameter), wrapped in a glowing amber ring (~2px solid + outer glow)
- Photos: tacos, burger, ramen bowl, pizza, drink/cocktail, dessert
- Label below each bubble: cuisine name in white, semibold, ~14px
- Spacing: bubbles touch the section edges with even gaps
- On 430px iPhone these will need to scroll horizontally OR shrink — leaning toward horizontal scroll with 80px bubbles to keep the visual style
- Each bubble + label is ONE tap target with a clear hover/press state (this was missing live)

## "Live Now" section
- Section header: "Live Now" left, "See All >" right
- 3 cards visible, peek of 4th at right edge (horizontal scroll)
- Each card:
  - Aspect ~3:4 portrait, ~280px wide on this mockup viewport
  - Full-bleed real food photo background (tacos, ramen, cocktail in mockup)
  - Top-left: orange/red "LIVE" pill with white text, semibold, ~11px
  - Top-right: outline heart icon (save), white
  - Bottom gradient overlay (transparent → dark) so text reads
  - Bottom-left text:
    - Truck name (white, semibold, ~18px)
    - Vibe with flame icon and amber color (~13px) e.g. "🔥 Crowd is Hot"
    - Wait + distance in white at 70% opacity, smaller, e.g. "4 min wait • 0.2 mi"
- Card has subtle outer ring, slightly darker inner shadow

## Bottom nav (floating glass)
- Pill shape, full width minus ~24px side margin
- Sits with safe-area inset clearance from bottom
- Background: dark glass with backdrop blur, soft amber outer ring
- 5 items, evenly spaced:
  1. Explore (compass icon) — ACTIVE state: amber color + small amber underline glow
  2. Saved (bookmark icon)
  3. Scout (CENTER, slightly elevated, amber circular ring with glow around the magnifying glass, NOT a fully filled solid amber button — just a ring)
  4. Alerts (bell icon)
  5. Profile (person icon)
- All icons + labels white at ~85% opacity except active and Scout

## What was wrong on the live site (to fix)
1. Headline shrunk to 52px on mobile and was wrapping "Good / evening," — needs to fit "Good evening," on one line
2. CTA was full-width banner — should be ~85% width pill
3. CTA was below the photo on a black band — should be ON the photo
4. Cravings were 4 items with no clear button affordance — should be 6 with glowing rings AS the affordance, full row tap targets
5. Live Now collapsed to empty rectangles when API failed — needs real empty state
6. Scout button was filled solid amber — should be just an amber ring with the icon inside, not filled
7. Sub-line was italic + said "Follow The Flavor." — keep "Follow The Flavor." but NOT italic per mockup style
