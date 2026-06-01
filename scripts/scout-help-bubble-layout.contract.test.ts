import { readFileSync } from "node:fs";

const longPressHelp = readFileSync("client/src/components/long-press-help.tsx", "utf8");
const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");

const requiredLongPressSnippets = [
  "autoHideMs?: number;",
  "disabled?: boolean;",
  "autoHideMs = 2200",
  "window.setTimeout(() => {",
  "if (disabled) {",
  "return <span className=\"relative inline-flex\">",
];

for (const snippet of requiredLongPressSnippets) {
  if (!longPressHelp.includes(snippet)) {
    throw new Error(`Missing help bubble behavior snippet: ${snippet}`);
  }
}

const requiredNavigationSnippets = [
  "const isScoutRoute =",
  "const disableScoutHelpBubbles = isScoutRoute;",
  "disabled={disableScoutHelpBubbles}",
  "className=\"fixed left-0 right-0 z-[1100] lg:hidden\"",
];

for (const snippet of requiredNavigationSnippets) {
  if (!navigation.includes(snippet)) {
    throw new Error(`Missing Scout help bubble safety snippet: ${snippet}`);
  }
}

console.log("scout-help-bubble-layout.contract: PASS");
