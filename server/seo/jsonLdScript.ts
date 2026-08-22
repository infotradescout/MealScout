const escapeJsonForHtmlScript = (json: string) =>
  json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export function buildJsonLdScript(value: object): string {
  const json = JSON.stringify(value);
  const scriptSafeJson = escapeJsonForHtmlScript(json || "null");
  return `<script type="application/ld+json">${scriptSafeJson}</script>`;
}
