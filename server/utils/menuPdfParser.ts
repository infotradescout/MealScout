/**
 * menuPdfParser.ts
 * Parses an uploaded PDF menu using an AI API (Anthropic Claude) to extract
 * structured item data.  Falls back gracefully if the API key is not configured.
 *
 * The PDF buffer is converted to a base64-encoded data string and passed as a
 * document to the Claude messages API.  Claude extracts items as structured JSON.
 */

type ParsedMenuItem = {
  menuId: string;
  restaurantId: string;
  name: string;
  description: string | null;
  priceCents: number;
  dietaryTags: string[];
  allergens: string[];
  isAvailable: boolean;
  sortOrder: number;
  categoryName: string | null;
};

type ParseResult = {
  imported: ParsedMenuItem[];
  skipped: number;
  errors: { row: number; reason: string }[];
};

const EXTRACTION_PROMPT = `
You are a menu digitization assistant. Extract all menu items from the document.
Return ONLY a valid JSON array (no prose, no markdown) with this shape per item:
[
  {
    "name": "string (required)",
    "description": "string or null",
    "price": number (USD dollars, e.g. 12.99),
    "category": "string or null (e.g. Appetizers, Mains, Drinks, Desserts)",
    "dietary_tags": ["vegan", "gluten-free", etc.],
    "allergens": ["nuts", "dairy", etc.]
  }
]
If a field is unknown, use null or []. Be conservative: only include items you are
confident about. Do not invent items not present in the document. The category
should match the section header the item appears under in the menu.
`.trim();

export async function parsePdfMenuWithAi(
  buffer: Buffer,
  menuId: string,
  restaurantId: string,
  mimeType?: string,
): Promise<ParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      imported: [],
      skipped: 0,
      errors: [
        {
          row: 0,
          reason:
            "PDF AI parsing is not configured (ANTHROPIC_API_KEY missing). " +
            "Please use CSV import or manual entry instead.",
        },
      ],
    };
  }

  let rawJson: string;

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const base64Data = buffer.toString("base64");
    const isImage = mimeType?.startsWith("image/") || false;

    const contentBlock = isImage
      ? {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: (mimeType || "image/jpeg") as any,
            data: base64Data,
          },
        }
      : {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: base64Data,
          },
        };

    const message = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            contentBlock as any,
            {
              type: "text",
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b: any) => b.type === "text");
    rawJson =
      textBlock && "text" in textBlock && typeof textBlock.text === "string"
        ? textBlock.text.trim()
        : "";
  } catch (err: any) {
    return {
      imported: [],
      skipped: 0,
      errors: [
        {
          row: 0,
          reason: `AI extraction failed: ${err?.message || String(err)}`,
        },
      ],
    };
  }

  // Strip any accidental markdown code fences
  rawJson = rawJson
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: any[];
  try {
    parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) throw new Error("Expected array");
  } catch {
    return {
      imported: [],
      skipped: 0,
      errors: [
        {
          row: 0,
          reason:
            "AI returned malformed JSON. Try CSV import or manual entry for this menu.",
        },
      ],
    };
  }

  const imported: ParsedMenuItem[] = [];
  const errors: { row: number; reason: string }[] = [];
  let skipped = 0;

  parsed.forEach((item: any, idx: number) => {
    const name = String(item.name || "").trim();
    if (!name) {
      skipped++;
      return;
    }

    const price = Number(item.price);
    if (isNaN(price) || price < 0) {
      errors.push({
        row: idx,
        reason: `Item "${name}" has invalid price: ${item.price}`,
      });
      return;
    }

    imported.push({
      menuId,
      restaurantId,
      name,
      description: item.description ? String(item.description).trim() : null,
      priceCents: Math.round(price * 100),
      dietaryTags: Array.isArray(item.dietary_tags) ? item.dietary_tags : [],
      allergens: Array.isArray(item.allergens) ? item.allergens : [],
      isAvailable: true,
      sortOrder: imported.length,
      categoryName:
        typeof item.category === "string" && item.category.trim()
          ? item.category.trim().slice(0, 80)
          : null,
    });
  });

  return { imported, skipped, errors };
}
