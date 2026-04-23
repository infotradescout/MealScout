# Reusable Pin Zoom to Card Mode

This project now includes a reusable interaction controller at:
- client/src/components/maps/usePinZoomCardMode.ts

## Goal

Use one shared pattern across maps:
1. Normal zoom levels: show pins.
2. Close zoom levels: optionally switch to card mode.
3. Marker tap in card mode: highlight/select card instead of opening a map popup.

## Hook API

`usePinZoomCardMode<TMarker>(options)`

Options:
- `enabled`: hard on/off switch for safe rollout.
- `zoom`: current map zoom.
- `cardsAtOrAboveZoom`: threshold where card mode becomes active.
- `markers`: marker list used to derive cards.
- `markerId`: stable id getter.
- `includeMarker`: optional filter for marker kinds eligible for cards.
- `dedupeKey`: optional grouping key to avoid duplicate cards.
- `maxCards`: cap rendered cards for performance.
- `hasBlockingSelection`: if true, force pins mode (e.g. detail modal already open).

Returns:
- `mode`: `pins` or `cards`.
- `showPins`: boolean shortcut.
- `showCards`: boolean shortcut.
- `cards`: derived card items.
- `activeCardId`: selected card id.
- `setActiveCardId`: manual selection control.
- `handlePinTap`: pin tap behavior for card mode.
- `clearActiveCard`: reset selection.

## Current Integration

Map page has this wired behind a disabled flag:
- `enablePinZoomCardMode = false`
- markers are computed through `mapMarkersForRender`

File:
- client/src/pages/map.tsx

This keeps production behavior stable while the reusable controller is available for rollout.

## Rollout Checklist (for this repo and future repos)

1. Turn flag on in target page.
2. Render card rail/overlay from `pinZoomCardMode.cards`.
3. Use `pinZoomCardMode.activeCardId` for selected styling.
4. On map marker tap, call `pinZoomCardMode.handlePinTap(marker)` first.
5. Keep popup/detail flows behind `hasBlockingSelection` so mode does not fight modal UI.
6. Tune `cardsAtOrAboveZoom` by use case:
   - City browse: 14-15
   - Neighborhood browse: 15-16
   - Parcel/spot browse: 16+

## Why this is portable

The controller is marker-type generic and map-library agnostic.
You can reuse it with Google Maps, Leaflet, Mapbox, and custom renderers by mapping your marker model into the hook options.
