import assert from "node:assert/strict";
import {
  assessPublicMenuCompleteness,
  normalizeBusinessTypeLabel,
} from "../client/src/lib/publicMenuCompleteness";

function run() {
  const addonOnly = assessPublicMenuCompleteness({
    menuSections: [
      {
        name: "Extras",
        items: [{ name: "Extra toppings", priceLabel: "$0.50", description: null, imageUrl: null, featured: false }],
      },
    ],
  });
  assert.equal(addonOnly.state, "partial", "add-on-only menu should be partial");

  const complete = assessPublicMenuCompleteness({
    menuSections: [
      {
        name: "Signature Bowls",
        items: [
          { name: "Firecracker", priceLabel: "$18.00", description: null, imageUrl: null, featured: false },
          { name: "Pensacola Beach", priceLabel: "$18.00", description: null, imageUrl: null, featured: false },
        ],
      },
    ],
  });
  assert.equal(complete.state, "complete", "multi-item priced menu should be complete");

  const unavailable = assessPublicMenuCompleteness({
    menuSections: [],
    featuredMenuItems: [],
    menuUrl: null,
    menuImageUrl: null,
    menuPdfUrl: null,
  });
  assert.equal(unavailable.state, "unavailable", "no menu evidence should be unavailable");

  assert.equal(normalizeBusinessTypeLabel("food_truck"), "Food truck");
  assert.equal(normalizeBusinessTypeLabel("restaurant"), "Restaurant");

  console.log("testPublicProfileMenuCompleteness: ok");
}

run();
