/**
 * menuFileNormalizer.ts
 *
 * Goal: let menu owners upload their menu in WHATEVER form they have it, and
 * normalize the bytes to something the downstream parser (Anthropic Claude) can
 * actually accept. Anthropic's vision API accepts only:
 *   - application/pdf
 *   - image/jpeg, image/png, image/gif, image/webp
 *
 * Owners frequently have:
 *   - iPhone photos (image/heic, image/heif)  ← what Sean almost certainly tried
 *   - Android camera photos (image/jpeg)       ← already supported
 *   - Screenshots (image/png)                  ← already supported
 *   - Modern Android photos (image/avif)       ← becoming common
 *   - Scanner output (image/tiff, image/bmp)   ← occasional
 *   - PDFs                                     ← already supported
 *
 * This util takes the raw upload buffer + (possibly wrong) mimetype and returns
 * a buffer that Claude can ingest, plus a normalized mimetype label and a
 * source label for the menu_import_logs row.
 *
 * If the file is genuinely unsupported (e.g. a .docx, a video, a corrupt blob),
 * it returns an Error result with a human-readable reason that is safe to show
 * to both admins (in the launch-week feed) and to the uploader.
 *
 * No external network calls. CPU-only transcoding.
 */

import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";

// Anthropic Claude vision-supported types (do NOT change without checking the
// Anthropic SDK docs):
const CLAUDE_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// Image types we will transcode to JPEG before sending to Claude. This is the
// "we accept anything from your phone" list.
const TRANSCODE_TO_JPEG_MIMES = new Set([
  "image/heic",
  "image/heif",
  "image/avif",
  "image/tiff",
  "image/bmp",
  "image/x-bmp",
  "image/x-ms-bmp",
  "image/svg+xml",
]);

// File-type extensions we recognize as image-likely (file-type returns an `ext`
// without dot).
const TRANSCODE_TO_JPEG_EXTS = new Set([
  "heic",
  "heif",
  "avif",
  "tif",
  "tiff",
  "bmp",
  "svg",
]);

const CLAUDE_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

export type NormalizedMenuFile = {
  ok: true;
  /** Buffer ready for Claude */
  buffer: Buffer;
  /** Mimetype Claude will accept ("application/pdf" or one of its image mimes) */
  mimeType: string;
  /** Label for menu_import_logs.source ("pdf" | "image") */
  source: "pdf" | "image";
  /** What we did to the buffer ("none" | "transcoded" | "passthrough-image" | "passthrough-pdf") */
  appliedTransform:
    | "none"
    | "passthrough-pdf"
    | "passthrough-image"
    | "transcoded-to-jpeg";
  /** What the file appeared to be before normalization (best-effort detection) */
  detectedMime: string;
  /** Human-readable note (safe to log) */
  note: string;
};

export type NormalizedMenuFileError = {
  ok: false;
  /** Human-readable reason safe to show users AND log to menu_import_logs */
  reason: string;
  /** What we detected (best effort) */
  detectedMime: string;
  /** "unsupported" | "transcode_failed" | "empty" */
  code: "unsupported" | "transcode_failed" | "empty";
};

export type NormalizeResult = NormalizedMenuFile | NormalizedMenuFileError;

/**
 * Normalize an uploaded menu file (PDF or any image format) into a buffer that
 * Anthropic Claude can ingest. Never throws — returns a structured result.
 */
export async function normalizeMenuFile(
  buffer: Buffer,
  reportedMimeType: string | undefined,
  reportedFileName: string | undefined,
): Promise<NormalizeResult> {
  if (!buffer || buffer.length === 0) {
    return {
      ok: false,
      reason: "Uploaded file is empty.",
      detectedMime: "unknown",
      code: "empty",
    };
  }

  // Detect the real type from the buffer — do NOT trust the client header.
  // file-type can identify pdf, jpg, png, gif, webp, heic, heif, avif, tif, bmp.
  let detectedMime = (reportedMimeType || "").toLowerCase();
  let detectedExt = "";
  try {
    const detected = await fileTypeFromBuffer(buffer);
    if (detected) {
      detectedMime = detected.mime.toLowerCase();
      detectedExt = detected.ext.toLowerCase();
    } else if (
      reportedFileName &&
      /\.(svg)$/i.test(reportedFileName)
    ) {
      // file-type doesn't sniff SVG (text). Trust extension here.
      detectedMime = "image/svg+xml";
      detectedExt = "svg";
    }
  } catch {
    // fall through using reported mime
  }

  // PDF passthrough.
  if (detectedMime === "application/pdf" || detectedExt === "pdf") {
    return {
      ok: true,
      buffer,
      mimeType: "application/pdf",
      source: "pdf",
      appliedTransform: "passthrough-pdf",
      detectedMime: "application/pdf",
      note: "pdf",
    };
  }

  // Native Claude-supported image passthrough.
  if (
    CLAUDE_IMAGE_MIMES.has(detectedMime) ||
    CLAUDE_IMAGE_EXTS.has(detectedExt)
  ) {
    // Normalize the mime label to the canonical one Claude expects.
    const canonical =
      detectedExt === "jpg"
        ? "image/jpeg"
        : detectedMime || `image/${detectedExt}`;
    return {
      ok: true,
      buffer,
      mimeType: canonical,
      source: "image",
      appliedTransform: "passthrough-image",
      detectedMime: canonical,
      note: `image (${canonical})`,
    };
  }

  // Transcode HEIC/HEIF/AVIF/TIFF/BMP/SVG → JPEG so Claude can read it.
  if (
    TRANSCODE_TO_JPEG_MIMES.has(detectedMime) ||
    TRANSCODE_TO_JPEG_EXTS.has(detectedExt)
  ) {
    try {
      let intermediate = buffer;

      // libheif (used by sharp) is not built into the Linux prebuilt sharp
      // binary on every platform. We use heic-convert (pure JS) for HEIC/HEIF
      // and let sharp handle everything else.
      if (
        detectedMime === "image/heic" ||
        detectedMime === "image/heif" ||
        detectedExt === "heic" ||
        detectedExt === "heif"
      ) {
        const heicConvert = (await import("heic-convert")).default;
        const converted = await heicConvert({
          buffer: intermediate as any,
          format: "JPEG",
          quality: 0.92,
        });
        intermediate = Buffer.from(converted as ArrayBufferLike);
      }

      // Final pass through sharp:
      //  - decode whatever we have (jpeg from HEIC, raw AVIF/TIFF/BMP/SVG)
      //  - re-encode as JPEG quality 88
      //  - cap longest edge at 2000px so Claude vision stays under its image
      //    size budget while keeping menu text readable
      const jpegBuffer = await sharp(intermediate, { failOn: "none" })
        .rotate() // honor EXIF orientation
        .resize({
          width: 2000,
          height: 2000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer();

      return {
        ok: true,
        buffer: jpegBuffer,
        mimeType: "image/jpeg",
        source: "image",
        appliedTransform: "transcoded-to-jpeg",
        detectedMime: detectedMime || `image/${detectedExt}` || "unknown",
        note: `transcoded ${detectedMime || detectedExt} → image/jpeg`,
      };
    } catch (err: any) {
      return {
        ok: false,
        reason:
          `We could not read this ${detectedMime || detectedExt || "image"} file ` +
          `(transcoding failed: ${truncateReason(err?.message || String(err))}). ` +
          `Please try a JPG, PNG, or PDF instead.`,
        detectedMime: detectedMime || `image/${detectedExt}` || "unknown",
        code: "transcode_failed",
      };
    }
  }

  // Genuinely unsupported (e.g. .docx, .pages, .mp4, .zip, unknown blob).
  return {
    ok: false,
    reason:
      `We can't read this file type (${detectedMime || "unknown"}). ` +
      `Please upload a PDF or a photo of your menu (JPG, PNG, HEIC, AVIF, WebP, GIF, TIFF, or BMP all work).`,
    detectedMime: detectedMime || "unknown",
    code: "unsupported",
  };
}

/** Trim long error messages so they fit cleanly in the admin UI + DB column. */
function truncateReason(s: string, max = 200): string {
  const single = String(s).replace(/\s+/g, " ").trim();
  return single.length > max ? single.slice(0, max - 1) + "…" : single;
}

/** Exposed list of accepted file types for FE accept= attribute and helper text. */
export const ACCEPTED_MENU_UPLOAD_LABEL =
  "PDF, JPG, PNG, HEIC, AVIF, WebP, GIF, TIFF, or BMP";

/** Comma-separated MIME list and extension list for HTML <input accept="...">. */
export const ACCEPTED_MENU_UPLOAD_ACCEPT_ATTR = [
  "application/pdf",
  ".pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/tiff",
  "image/bmp",
  "image/svg+xml",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
  ".avif",
  ".tif",
  ".tiff",
  ".bmp",
  ".svg",
].join(",");
