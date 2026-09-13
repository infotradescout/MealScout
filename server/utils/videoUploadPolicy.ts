const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/ogg",
  "video/x-msvideo",
  "video/mpeg",
]);

export type DetectedVideoContainer =
  | "iso-bmff"
  | "ebml"
  | "ogg"
  | "avi"
  | "mpeg";

export function normalizeVideoMimeType(value: unknown): string {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

export function isAllowedDeclaredVideoMime(value: unknown): boolean {
  return ALLOWED_VIDEO_MIME_TYPES.has(normalizeVideoMimeType(value));
}

export function detectVideoContainer(
  buffer: Buffer | Uint8Array,
): DetectedVideoContainer | null {
  const bytes = Buffer.from(buffer);
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    return "iso-bmff";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "ebml";
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "OggS") {
    return "ogg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "AVI "
  ) {
    return "avi";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    (bytes[3] === 0xba || bytes[3] === 0xb3)
  ) {
    return "mpeg";
  }
  return null;
}

export function isVideoContentCompatible(
  buffer: Buffer | Uint8Array,
  declaredMime: unknown,
): boolean {
  const mime = normalizeVideoMimeType(declaredMime);
  const container = detectVideoContainer(buffer);
  if (!container || !ALLOWED_VIDEO_MIME_TYPES.has(mime)) return false;

  if (mime === "video/mp4" || mime === "video/quicktime") {
    return container === "iso-bmff";
  }
  if (mime === "video/webm" || mime === "video/x-matroska") {
    return container === "ebml";
  }
  if (mime === "video/ogg") return container === "ogg";
  if (mime === "video/x-msvideo") return container === "avi";
  if (mime === "video/mpeg") return container === "mpeg";
  return false;
}
