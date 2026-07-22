import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { Request } from 'express';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

// Configure multer for memory storage
const storage = multer.memoryStorage();

const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Accept only images
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'));
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
});

// Upload image to Cloudinary
export async function uploadToCloudinary(
  fileBuffer: Buffer,
  folder: string,
  publicId?: string
): Promise<{
  publicId: string;
  url: string;
  secureUrl: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  thumbnailUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `mealscout/${folder}`,
        public_id: publicId,
        transformation: [
          { width: 1200, height: 1200, crop: 'limit' }, // Max dimensions
          { quality: 'auto' }, // Auto quality optimization
          { fetch_format: 'auto' }, // Auto format (WebP where supported)
        ],
        eager: [
          { width: 300, height: 300, crop: 'fill', gravity: 'auto' }, // Thumbnail
        ],
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            publicId: result.public_id,
            url: result.url,
            secureUrl: result.secure_url,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
            thumbnailUrl: result.eager?.[0]?.secure_url || result.secure_url,
          });
        } else {
          reject(new Error('Upload failed'));
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
}

/**
 * Evidence that is still waiting for owner review must not use Cloudinary's
 * normal public `upload` delivery type.  Keep the original bytes in the
 * authenticated namespace; authorized review routes can mint a signed URL
 * after checking access to the owning restaurant and the live upload row.
 */
export async function uploadPrivateEvidenceToCloudinary(
  fileBuffer: Buffer,
  folder: string,
  publicId: string,
): Promise<{
  publicId: string;
  url: string;
  secureUrl: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  thumbnailUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `mealscout/${folder}`,
        public_id: publicId,
        type: "authenticated",
        transformation: [
          { width: 1200, height: 1200, crop: "limit" },
          { quality: "auto" },
          { fetch_format: "auto" },
        ],
        eager: [
          { width: 300, height: 300, crop: "fill", gravity: "auto" },
        ],
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result) {
          resolve({
            publicId: result.public_id,
            url: result.url,
            secureUrl: result.secure_url,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
            thumbnailUrl: result.eager?.[0]?.secure_url || result.secure_url,
          });
        } else {
          reject(new Error("Private evidence upload failed"));
        }
      },
    );

    uploadStream.end(fileBuffer);
  });
}

export function createAuthenticatedEvidenceReviewUrl(
  cloudinaryPublicId: string,
  mimeTypeOrFormat: string,
  nowMs = Date.now(),
): string | null {
  const publicId = String(cloudinaryPublicId || "").trim();
  const requestedFormat = String(mimeTypeOrFormat || "")
    .trim()
    .toLowerCase();
  const format =
    ({
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      jpeg: "jpg",
      jpg: "jpg",
      "image/png": "png",
      png: "png",
      "image/webp": "webp",
      webp: "webp",
      "image/gif": "gif",
      gif: "gif",
      "image/avif": "avif",
      avif: "avif",
    } as Record<string, string>)[requestedFormat] || null;
  if (
    !publicId ||
    publicId.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(publicId) ||
    !format ||
    !Number.isFinite(nowMs) ||
    !isCloudinaryConfigured()
  ) {
    return null;
  }
  return cloudinary.utils.private_download_url(publicId, format, {
    type: "authenticated",
    resource_type: "image",
    attachment: false,
    expires_at: Math.floor(nowMs / 1000) + 5 * 60,
  });
}

export const isAuthenticatedCloudinaryDeliveryUrl = (value: unknown) =>
  /\/image\/authenticated\//.test(String(value || ""));

// Delete image from Cloudinary
export async function deleteFromCloudinary(
  publicId: string,
  options?: { type?: "upload" | "authenticated" | "private" },
): Promise<void> {
  await cloudinary.uploader.destroy(publicId, {
    type: options?.type || "upload",
  });
}

// Check if Cloudinary is configured
export function isCloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}
