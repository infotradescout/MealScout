import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  escapeHtml,
  sanitizeEmailSubject,
} from "../server/utils/htmlEscape.ts";

assert.equal(
  escapeHtml(`<img src=x onerror="alert('x')"> &`),
  "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp;",
);
assert.equal(
  sanitizeEmailSubject("Hello\r\nBcc: victim@example.com"),
  "Hello Bcc: victim@example.com",
);

for (const file of [
  "server/emailNotifications.ts",
  "server/truckEventMatchService.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert(source.includes("escapeHtml"), `${file} must escape dynamic HTML`);
  assert(
    source.includes("sanitizeEmailSubject"),
    `${file} must strip control characters from dynamic subjects`,
  );
}

const notifications = readFileSync("server/emailNotifications.ts", "utf8");
assert(!notifications.includes("${message.trim()}"));
assert(!notifications.includes("${restaurant.name}</strong>"));

const matches = readFileSync("server/truckEventMatchService.ts", "utf8");
for (const unsafe of [
  "${request.notes}</em>",
  "${request.contactEmail}</a>",
  "${series.description}</em>",
  "${host.businessName}</strong>",
]) {
  assert(!matches.includes(unsafe), `Raw email HTML interpolation remains: ${unsafe}`);
}

console.log("email HTML safety behavior passed");
