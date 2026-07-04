/**
 * menuImageIngest.ts
 * Downloads menu-item images from a source URL and re-hosts them in MealScout's
 * Cloudinary account so the item image survives the source site (their old
 * website / Square / delivery platform) going away.
 *
 * Best-effort by design: if re-hosting isn't possible (Cloudinary not
 * configured, image unreachable, non-image content, blocked host), the original
 * source URL is returned unchanged so imports never fail because of an image.
 */
import { assertPublicHostname } from "./websiteProfileImport";
import { uploadToCloudinary, isCloudinaryConfigured } from "../imageUpload";

const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_REDIRECTS = 2;

async function fetchImageBuffer(startUrl: string): Promise<Buffer | null> {
  let current = startUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    // Re-validate on every hop to prevent redirect-based SSRF.
    try {
      await assertPublicHostname(parsed.hostname);
    } catch {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "MealScoutMenuImport/1.0 (+https://www.mealscout.us)",
          Accept: "image/*",
        },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, parsed).toString();
      continue;
    }

    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength && contentLength > MAX_IMAGE_BYTES) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return null;
    }
    return buffer;
  }

  return null;
}

/**
 * Re-host a single image URL. Returns the MealScout-hosted URL on success, or
 * the original source URL as a fallback so the item still has an image.
 */
export async function ingestMenuImage(
  sourceUrl: string | null | undefined,
  folder = "menu-items",
): Promise<string | null> {
  const url = (sourceUrl || "").trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  // Without Cloudinary we can't re-host; keep the source URL as a hotlink.
  if (!isCloudinaryConfigured()) return url;

  const buffer = await fetchImageBuffer(url);
  if (!buffer) return url;

  try {
    const result = await uploadToCloudinary(buffer, folder);
    return result.secureUrl;
  } catch {
    return url;
  }
}

/**
 * Re-host every image URL on a batch of imported items (in place), with limited
 * concurrency so a large menu import doesn't open hundreds of sockets at once.
 */
export async function rehostImportedImages<
  T extends { imageUrl?: string | null },
>(items: T[], folder = "menu-items", concurrency = 4): Promise<void> {
  const targets = items.filter((item) => item.imageUrl);
  if (targets.length === 0) return;

  let index = 0;
  const worker = async () => {
    while (index < targets.length) {
      const item = targets[index++];
      item.imageUrl = await ingestMenuImage(item.imageUrl, folder);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, worker),
  );
}
