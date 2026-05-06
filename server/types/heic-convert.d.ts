/**
 * Ambient module declaration for `heic-convert` (no official types as of 2.x).
 * We only use the default export call signature: convert HEIC/HEIF buffer to a
 * JPEG/PNG buffer.
 */
declare module "heic-convert" {
  type HeicConvertFormat = "JPEG" | "PNG";

  interface HeicConvertOptions {
    /** Input HEIC/HEIF buffer (Buffer or ArrayBuffer). */
    buffer: ArrayBuffer | Uint8Array | Buffer;
    /** Output format. */
    format: HeicConvertFormat;
    /** JPEG quality 0..1. Ignored for PNG. */
    quality?: number;
  }

  /** Convert a HEIC/HEIF buffer to the requested format. */
  function heicConvert(options: HeicConvertOptions): Promise<ArrayBuffer>;

  export default heicConvert;
}
