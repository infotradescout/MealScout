import * as http from "node:http";
import * as https from "node:https";

import { resolvePublicHostname } from "./websiteProfileImport";

export type PinnedPublicImageOptions = {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  allowedContentTypes: ReadonlySet<string>;
  accept: string;
  userAgent: string;
};

type HopResult =
  | { redirectUrl: string }
  | { buffer: Buffer; contentType: string };

function requestPinnedImage(
  parsed: URL,
  address: string,
  family: number,
  options: PinnedPublicImageOptions,
): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const transport = parsed.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: parsed.protocol,
        hostname: address,
        family,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        servername: parsed.protocol === "https:" ? parsed.hostname : undefined,
        rejectUnauthorized: true,
        headers: {
          Host: parsed.host,
          Accept: options.accept,
          "User-Agent": options.userAgent,
          Connection: "close",
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            reject(new Error("Image redirect is missing a location"));
            return;
          }
          resolve({ redirectUrl: new URL(location, parsed).toString() });
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Image download failed (${status})`));
          return;
        }

        const contentType = String(response.headers["content-type"] || "")
          .split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (!options.allowedContentTypes.has(contentType)) {
          response.resume();
          reject(new Error("Image must use a supported raster format"));
          return;
        }
        const declaredBytes = Number(response.headers["content-length"] || 0);
        if (declaredBytes > options.maxBytes) {
          response.resume();
          reject(new Error("Image exceeds the allowed size"));
          return;
        }

        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on("data", (chunk: Buffer | Uint8Array) => {
          const buffer = Buffer.from(chunk);
          byteLength += buffer.byteLength;
          if (byteLength > options.maxBytes) {
            response.destroy(new Error("Image exceeds the allowed size"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          if (!byteLength) {
            reject(new Error("Image response was empty"));
            return;
          }
          resolve({ buffer: Buffer.concat(chunks), contentType });
        });
        response.on("error", reject);
      },
    );
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("Image request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * Fetch a public raster image while pinning each network connection to an IP
 * that was validated immediately beforehand. Redirects are resolved and pinned
 * independently, closing the DNS-rebinding gap in hostname-check-then-fetch
 * implementations.
 */
export async function fetchPinnedPublicImage(
  startUrl: string,
  options: PinnedPublicImageOptions,
) {
  let current = String(startUrl || "").trim();
  for (let redirects = 0; redirects <= options.maxRedirects; redirects += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error("Invalid image URL");
    }
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("Image URL must use unauthenticated http(s)");
    }

    const records = await resolvePublicHostname(parsed.hostname);
    let lastError: unknown = null;
    let hop: HopResult | null = null;
    for (const record of records.slice(0, 4)) {
      try {
        hop = await requestPinnedImage(
          parsed,
          record.address,
          record.family,
          options,
        );
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!hop) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Image could not be loaded");
    }
    if ("redirectUrl" in hop) {
      if (redirects === options.maxRedirects) {
        throw new Error("Image redirected too many times");
      }
      current = hop.redirectUrl;
      continue;
    }
    return hop;
  }
  throw new Error("Image redirected too many times");
}
