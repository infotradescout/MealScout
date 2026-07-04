/**
 * menuPhotoParser.ts
 * Extracts menu items from photos (a printed menu / menu board, and/or photos
 * of individual dishes) using Gemini Flash vision. Mirrors menuPdfParser, but
 * uses a cheap vision model instead of Claude since photo imports can involve
 * several images per request.
 *
 * When an item is clearly the main subject of one of the uploaded photos (a
 * dish photo), the model returns that photo's 0-based `image_index`, letting the
 * caller attach the uploaded photo as the item's image — so photo imports can
 * produce a menu WITH images, not just text.
 *
 * Falls back gracefully when GEMINI_API_KEY is not configured.
 */

export type ParsedPhotoMenuItem = {
  menuId: string;
  restaurantId: string;
  name: string;
  description: string | null;
  priceCents: number;
  dietaryTags: string[];
  allergens: string[];
  isAvailable: boolean;
  sortOrder: number;
  imageUrl: string | null;
  // 0-based index into the uploaded images if this item is a standalone dish
  // photo; null for items read off a menu board / printed menu.
  imageIndex: number | null;
};

type ParseResult = {
  imported: ParsedPhotoMenuItem[];
  skipped: number;
  errors: { row: number; reason: string }[];
};

export type MenuPhotoInput = { buffer: Buffer; mediaType: string };

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Image formats Gemini's vision input accepts.
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function isSupportedMenuPhotoImage(mediaType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.has((mediaType || "").toLowerCase());
}

const EXTRACTION_PROMPT = `
You are a menu digitization assistant. The user uploaded one or more photos.
They may be photos of a printed menu / menu board, and/or photos of individual dishes.
Extract every menu item you can actually read or clearly identify.

Return ONLY a valid JSON array (no prose, no markdown) with this shape per item:
[
  {
    "name": "string (required)",
    "description": "string or null",
    "price": number (USD dollars, e.g. 12.99) or null,
    "dietary_tags": ["vegan", "gluten-free", ...],
    "allergens": ["nuts", "dairy", ...],
    "image_index": integer or null
  }
]

Rules:
- Only include items you can actually read/see. Never invent items or prices.
- If a price is not visible, use null.
- Set "image_index" to the 0-based index of an uploaded photo ONLY when that photo
  clearly depicts this single dish (a dish photo). For items read off a menu board
  or printed menu, use null.
`.trim();

export async function parseImageMenuWithAi(
  images: MenuPhotoInput[],
  menuId: string,
  restaurantId: string,
): Promise<ParseResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      imported: [],
      skipped: 0,
      errors: [
        {
          row: 0,
          reason:
            "Photo menu extraction is not configured (GEMINI_API_KEY missing). " +
            "Please use CSV import or manual entry instead.",
        },
      ],
    };
  }

  const usableImages = images.filter((img) =>
    SUPPORTED_IMAGE_TYPES.has(img.mediaType.toLowerCase()),
  );
  if (usableImages.length === 0) {
    return {
      imported: [],
      skipped: 0,
      errors: [
        {
          row: 0,
          reason:
            "No supported images provided. Use JPEG, PNG, WebP, or HEIC photos.",
        },
      ],
    };
  }

  let rawJson: string;
  try {
    const { GoogleGenAI, createUserContent, createPartFromBase64 } =
      await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    const imageParts = usableImages.map((img) =>
      createPartFromBase64(img.buffer.toString("base64"), img.mediaType),
    );

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: createUserContent([...imageParts, EXTRACTION_PROMPT]),
    });

    rawJson = (response.text || "").trim();
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

  const imported: ParsedPhotoMenuItem[] = [];
  let skipped = 0;

  parsed.forEach((item: any) => {
    const name = String(item.name || "").trim();
    if (!name) {
      skipped++;
      return;
    }

    // Photos frequently omit prices (e.g. a dish photo); keep the item at 0 so
    // the owner can fill it in during review rather than losing the item+image.
    const price = Number(item.price);
    const priceCents = isNaN(price) || price < 0 ? 0 : Math.round(price * 100);

    let imageIndex: number | null = null;
    const idx = Number(item.image_index);
    if (
      Number.isInteger(idx) &&
      idx >= 0 &&
      idx < usableImages.length
    ) {
      imageIndex = idx;
    }

    imported.push({
      menuId,
      restaurantId,
      name,
      description: item.description ? String(item.description).trim() : null,
      priceCents,
      dietaryTags: Array.isArray(item.dietary_tags) ? item.dietary_tags : [],
      allergens: Array.isArray(item.allergens) ? item.allergens : [],
      isAvailable: true,
      sortOrder: imported.length,
      imageUrl: null,
      imageIndex,
    });
  });

  return { imported, skipped, errors: [] };
}
