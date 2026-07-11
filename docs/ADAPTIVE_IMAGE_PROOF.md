# Adaptive Image Proof

## What problem this fixes

MealScout images need to look good in more than one place.

One uploaded image may appear as a card image, menu item image, profile hero, mobile banner, social share image, or thumbnail. Those placements do not all have the same shape.

This first proof adds an internal way for MealScout components to ask for the best image for a specific placement while still falling back safely to the original image.

## What surface was updated first

The first updated surface is the deal/vendor card image.

The card now asks for the `vendor_card` placement before displaying the image.

## Why the deal/vendor card was chosen

The deal/vendor card was chosen because it is highly visible and already had safe image fallback behavior.

That makes it the lowest-risk place to prove adaptive image behavior without changing upload, storage, or publishing flows.

## Supported placement ids

- `business_profile_hero`
- `vendor_card`
- `menu_item_card`
- `welcome_card_1200x630`
- `social_share_1200x630`
- `mobile_banner`
- `square_thumbnail`

## How fallback works

If placement-specific image metadata exists, the component uses that placement image.

If placement-specific metadata is missing, the component uses the original uploaded image URL.

If the original image URL is missing, the component uses the existing MealScout default cuisine image.

This keeps existing cards working even when adaptive metadata has not been created yet.

## Commands passed

- `npm run check`
- `npm run build`

## Screenshots to capture

Capture these before and after examples:

- Deal/vendor card with a normal uploaded deal image
- Deal/vendor card with missing adaptive metadata
- Deal/vendor card with missing uploaded image, showing the existing default cuisine image
- Mobile view of the deal/vendor card
- Desktop or wider layout if the card appears there

## Future persistence step

Later, MealScout should persist adaptive image metadata beside uploaded image records or the related business/deal/menu item image record.

That later step should store:

- Original image URL
- Focal point
- Supported placement ids
- Placement-specific image URLs when generated
- Width and height when known

Do not add this persistence until the first visual proof is reviewed.

## Internal visibility reminder

No MealScout user sees Continuum or `.fgp` yet.

This is internal image intelligence only. The user-facing MealScout brand and upload experience stay unchanged.
