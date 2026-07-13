export const SCOUT_SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  taco: ["taco", "tacos", "mexican", "tex-mex", "taqueria", "burrito", "quesadilla"],
  tacos: ["taco", "tacos", "mexican", "tex-mex", "taqueria", "burrito", "quesadilla"],
  burger: ["burger", "burgers", "hamburger", "cheeseburger"],
  burgers: ["burger", "burgers", "hamburger", "cheeseburger"],
  pizza: ["pizza", "pizzeria", "italian"],
  sushi: ["sushi", "japanese", "sashimi", "roll"],
  bbq: ["bbq", "barbecue", "brisket", "smoked"],
  barbecue: ["bbq", "barbecue", "brisket", "smoked"],
  wings: ["wing", "wings", "chicken"],
  vegan: ["vegan", "plant-based", "vegetarian"],
};

export function tokenizeScoutSearchIntent(query: string): string[] {
  return String(query || "")
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function expandScoutSearchTerms(query: string): string[] {
  return Array.from(
    new Set(
      tokenizeScoutSearchIntent(query).flatMap(
        (token) => SCOUT_SEARCH_ALIASES[token] ?? [token],
      ),
    ),
  );
}
