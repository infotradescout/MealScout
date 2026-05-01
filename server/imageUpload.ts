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

const imageFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Accept only images
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'));
  }
};

const supportedVideoMimeTypes = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const videoFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (supportedVideoMimeTypes.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only MP4, MOV, or WebM video files are allowed!'));
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
});

export const uploadVideo = multer({
  storage: storage,
  fileFilter: videoFileFilter,
  limits: {
    fileSize: Number(process.env.VIDEO_UPLOAD_MAX_BYTES || 100 * 1024 * 1024), // 100MB default
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

// Upload video to Cloudinary
export async function uploadVideoToCloudinary(
  fileBuffer: Buffer,
  folder: string,
  publicId?: string
): Promise<{
  publicId: string;
  url: string;
  secureUrl: string;
  width?: number;
  height?: number;
  format: string;
  bytes: number;
  durationSeconds?: number;
  thumbnailUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder: `mealscout/${folder}`,
        public_id: publicId,
        eager: [
          {
            width: 640,
            height: 360,
            crop: 'fill',
            gravity: 'auto',
            format: 'jpg',
          },
        ],
        eager_async: false,
      },
      (error, result: any) => {
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
            durationSeconds:
              typeof result.duration === 'number'
                ? Math.round(result.duration)
                : undefined,
            thumbnailUrl:
              result.eager?.[0]?.secure_url ||
              cloudinary.url(result.public_id, {
                resource_type: 'video',
                format: 'jpg',
                transformation: [
                  { width: 640, height: 360, crop: 'fill', gravity: 'auto' },
                ],
              }),
          });
        } else {
          reject(new Error('Video upload failed'));
        }
      }
    );

    uploadStream.end(fileBuffer);
  });
}

// Delete media from Cloudinary
export async function deleteFromCloudinary(
  publicId: string,
  resourceType: 'image' | 'video' = 'image',
): Promise<void> {
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

// Check if Cloudinary is configured
export function isCloudinaryConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}
