// Document validation utilities for verification system
export interface DocumentValidationError {
  field: string;
  message: string;
}

export interface DocumentValidationResult {
  valid: boolean;
  errors: DocumentValidationError[];
}

const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  "application/pdf",
];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

export function validateDocuments(documents: string[]): DocumentValidationResult {
  const errors: DocumentValidationError[] = [];
  
  // Check document count
  if (documents.length === 0) {
    errors.push({
      field: 'documents',
      message: 'At least one document is required'
    });
    return { valid: false, errors };
  }
  
  if (documents.length > MAX_FILES) {
    errors.push({
      field: 'documents',
      message: `Maximum ${MAX_FILES} documents allowed, got ${documents.length}`
    });
    return { valid: false, errors };
  }
  
  // Validate each document
  documents.forEach((document, index) => {
    const docErrors = validateSingleDocument(document, index);
    errors.push(...docErrors);
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
}

function validateSingleDocument(document: string, index: number): DocumentValidationError[] {
  const errors: DocumentValidationError[] = [];
  const fieldName = `documents[${index}]`;

  // Allow uploaded document URLs from Cloudinary in addition to inline data URLs.
  if (/^https?:\/\//i.test(document)) {
    const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
    const cloudinaryPrefix = cloudName
      ? `https://res.cloudinary.com/${cloudName}/`
      : "https://res.cloudinary.com/";
    if (!document.startsWith(cloudinaryPrefix)) {
      errors.push({
        field: fieldName,
        message:
          "Document URL must come from MealScout secure storage",
      });
    }
    return errors;
  }

  // Check if it's a data URL
  if (!document.startsWith('data:')) {
    errors.push({
      field: fieldName,
      message: 'Document must be a valid data URL or uploaded document URL'
    });
    return errors;
  }
  
  try {
    // Parse data URL to get MIME type and size
    const [header, base64Data] = document.split(',');
    
    if (!header || !base64Data) {
      errors.push({
        field: fieldName,
        message: 'Invalid data URL format'
      });
      return errors;
    }
    
    // Extract MIME type
    const mimeMatch = header.match(/data:([^;]+)/);
    if (!mimeMatch) {
      errors.push({
        field: fieldName,
        message: 'Could not determine file type'
      });
      return errors;
    }
    
    const mimeType = mimeMatch[1].toLowerCase();
    
    // Validate MIME type
    if (!ACCEPTED_MIME_TYPES.includes(mimeType)) {
      errors.push({
        field: fieldName,
        message: `File type '${mimeType}' not allowed. Allowed types: ${ACCEPTED_MIME_TYPES.join(', ')}`
      });
    }
    
    // Validate file size (base64 is ~33% larger than original)
    const approximateSize = (base64Data.length * 3) / 4;
    if (approximateSize > MAX_FILE_SIZE_BYTES) {
      const sizeMB = Math.round(approximateSize / (1024 * 1024) * 100) / 100;
      const maxSizeMB = MAX_FILE_SIZE_BYTES / (1024 * 1024);
      errors.push({
        field: fieldName,
        message: `File size ${sizeMB}MB exceeds maximum allowed size of ${maxSizeMB}MB`
      });
    }
    
    // Additional base64 validation
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
      errors.push({
        field: fieldName,
        message: 'Invalid base64 encoding'
      });
    }
    
  } catch (error) {
    errors.push({
      field: fieldName,
      message: 'Failed to validate document format'
    });
  }
  
  return errors;
}

// Rate limiting utilities (simple in-memory store)
const submissionAttempts = new Map<string, number[]>();

export function checkRateLimit(
  restaurantId: string,
  options: { record?: boolean } = {},
): { allowed: boolean; nextAllowedTime?: Date } {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const shouldRecord = options.record !== false;
  
  // Get existing attempts for this restaurant
  const attempts = submissionAttempts.get(restaurantId) || [];
  
  // Remove attempts older than 1 hour
  const recentAttempts = attempts.filter(timestamp => now - timestamp < oneHour);
  
  // Update the map with cleaned attempts
  submissionAttempts.set(restaurantId, recentAttempts);
  
  // Check if rate limit exceeded
  if (recentAttempts.length >= 1) { // Max 1 request per hour
    const oldestAttempt = Math.min(...recentAttempts);
    const nextAllowedTime = new Date(oldestAttempt + oneHour);
    
    return {
      allowed: false,
      nextAllowedTime
    };
  }
  
  if (shouldRecord) {
    recentAttempts.push(now);
    submissionAttempts.set(restaurantId, recentAttempts);
  }
  
  return { allowed: true };
}

export function recordRateLimitAttempt(restaurantId: string): void {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const attempts = submissionAttempts.get(restaurantId) || [];
  const recentAttempts = attempts.filter(timestamp => now - timestamp < oneHour);
  recentAttempts.push(now);
  submissionAttempts.set(restaurantId, recentAttempts);
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [restaurantId, attempts] of Array.from(submissionAttempts.entries())) {
    const recentAttempts = attempts.filter((timestamp: number) => now - timestamp < oneHour);
    if (recentAttempts.length === 0) {
      submissionAttempts.delete(restaurantId);
    } else {
      submissionAttempts.set(restaurantId, recentAttempts);
    }
  }
}, 15 * 60 * 1000); // Clean up every 15 minutes
