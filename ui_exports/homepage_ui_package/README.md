# MealScout Home Page UI Package

This package is a portable extraction of the current home page and key direct dependencies for UI iteration in external editors.

## Included
- client/src/pages/home.tsx
- Key direct component/hook/lib dependencies used by home.tsx
- shared/rankingPolicy.ts
- client/src/index.css for visual reference

## Notes
- This is a UI working package, not a full runnable app by itself.
- Some imports may require stubs/mocks in external editors.
- Use this package for layout, copy, spacing, and visual iteration.

## Suggested workflow in other editors
1. Open client/src/pages/home.tsx
2. Keep structure and class names, iterate visual layout
3. Return updated home.tsx (and changed dependent files) back to this repo

## Source snapshot
- Generated from branch: main
- Generated at: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss K")
