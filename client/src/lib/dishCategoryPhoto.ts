export type DishCategoryPhoto = { image: string; label: string };

const DISH_CATEGORY_PHOTO_RULES: Array<{
  match: RegExp;
  image: string;
  label: string;
}> = [
  // Ordered most-specific-first: several real menu items hit more than one
  // keyword group (e.g. "Authentic Cuban Sandwich" contains "pulled pork"),
  // and the first matching rule wins, so the more specific dish category
  // goes ahead of the broader one it could otherwise get misread as.
  {
    match:
      /sandwich|\bsub\b|hoagie|\bcuban\b|panini|\bwrap\b|\bmelt\b|po.?boy/i,
    image: "/atmospheric/craving-sandwich.jpg",
    label: "Sandwiches",
  },
  {
    match: /\bbbq\b|barbecue|brisket|\bribs\b|pulled pork|smoked|smokehouse/i,
    image: "/atmospheric/craving-bbq.jpg",
    label: "BBQ",
  },
  {
    match: /\bwings?\b|buffalo|hot wings|\bflats\b|\bdrums\b/i,
    image: "/atmospheric/craving-wings.jpg",
    label: "Wings",
  },
  {
    match: /\bpoke\b|sushi|ahi tuna|nigiri|sashimi|\bmaki\b|poke bowl/i,
    image: "/atmospheric/craving-poke.jpg",
    label: "Poke & Sushi",
  },
  {
    match:
      /seafood|shrimp|\bcrab\b|\bfish\b|grouper|snapper|oyster|scallop|lobster/i,
    image: "/atmospheric/craving-seafood.jpg",
    label: "Seafood",
  },
  {
    match: /salad|greens|caesar|garden salad|greek salad|chopped salad/i,
    image: "/atmospheric/craving-salad.jpg",
    label: "Salads",
  },
  {
    match: /\bcoffee\b|\blatte\b|espresso|cappuccino|cold brew|\bmocha\b/i,
    image: "/atmospheric/craving-coffee.jpg",
    label: "Coffee",
  },
  {
    match:
      /smoothie bowl|acai|açaí|berry bowl|granola bowl|pitaya|\bgranola\b|\bblended\b/i,
    image: "/atmospheric/craving-smoothie-bowl.jpg",
    label: "Smoothie Bowls",
  },
  {
    match:
      /breakfast|\beggs\b|\bbacon\b|biscuit|pancakes?|\bwaffles?\b|hash browns?|omelet|brunch/i,
    image: "/atmospheric/craving-breakfast.jpg",
    label: "Breakfast",
  },
  {
    match: /burger|cheeseburger|hamburger|smash/i,
    image: "/atmospheric/craving-burgers.jpg",
    label: "Burgers",
  },
  {
    match: /taco|burrito|quesadilla|nacho/i,
    image: "/atmospheric/craving-tacos.jpg",
    label: "Tacos",
  },
  {
    match: /pizza|slice|calzone/i,
    image: "/atmospheric/craving-pizza.jpg",
    label: "Pizza",
  },
  {
    match: /ramen|noodle|pho\b/i,
    image: "/atmospheric/craving-ramen.jpg",
    label: "Noodles",
  },
  {
    match: /ice cream|dessert|\bcake\b|cookie|donut|pastry|churro/i,
    image: "/atmospheric/craving-dessert.jpg",
    label: "Desserts",
  },
  {
    match: /juice|drink|tea\b|lemonade|boba/i,
    image: "/atmospheric/craving-drinks.jpg",
    label: "Drinks",
  },
];

export function getDishCategoryPhoto(
  ...textParts: Array<string | null | undefined>
): DishCategoryPhoto | null {
  const haystack = textParts.filter(Boolean).join(" ").toLowerCase();
  if (!haystack.trim()) return null;
  for (const rule of DISH_CATEGORY_PHOTO_RULES) {
    if (rule.match.test(haystack))
      return { image: rule.image, label: rule.label };
  }
  return null;
}
