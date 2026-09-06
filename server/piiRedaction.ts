/**
 * PII Redaction and Audit Logging
 * 
 * Redacts personally identifiable information before storing in audit logs.
 * Ensures compliance with privacy regulations (GDPR, CCPA, etc.).
 */

/**
 * List of patterns and fields to redact
 */
const redactionRules = {
  // Email addresses - redact domain
  email: (value: string) => {
    if (typeof value !== 'string') return value;
    const [local] = value.split('@');
    return `${local.slice(0, 3)}***@***.com`;
  },

  // Phone numbers - redact middle digits
  phone: (value: string) => {
    if (typeof value !== 'string') return value;
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length < 7) return '****';
    return `${cleaned.slice(0, 2)}***${cleaned.slice(-2)}`;
  },

  // Credit card - redact everything but last 4
  creditCard: (value: string) => {
    if (typeof value !== 'string') return value;
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length < 4) return '****';
    return `****-****-****-${cleaned.slice(-4)}`;
  },

  // SSN - redact first 5 digits
  ssn: (value: string) => {
    if (typeof value !== 'string') return value;
    return `***-**-${value.slice(-4)}`;
  },

  // Passport - redact first half
  passport: (value: string) => {
    if (typeof value !== 'string') return value;
    return `${value.slice(0, 2)}****`;
  },

  // API Key - redact all but first and last 4
  apiKey: (value: string) => {
    if (typeof value !== 'string' || value.length < 8) return '****';
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
  },

  // Password - redact completely
  password: () => '***REDACTED***',

  // Full name - redact last name
  fullName: (value: string) => {
    if (typeof value !== 'string') return value;
    const parts = value.trim().split(' ');
    if (parts.length < 2) return value;
    return `${parts[0]} ${parts[parts.length - 1].replace(/./g, '*')}`;
  },

  // Address - keep only city/state
  address: (value: string) => {
    if (typeof value !== 'string') return value;
    // Simple heuristic: keep last 10 chars (usually city/state/zip)
    return `***${value.slice(-10)}`;
  },

  // IP address - redact last octet
  ipAddress: (value: string) => {
    if (typeof value !== 'string') return value;
    const parts = value.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
    }
    return value;
  },

  // UUID - keep first 8 chars
  uuid: (value: string) => {
    if (typeof value !== 'string') return value;
    return `${value.slice(0, 8)}***`;
  },
};

/**
 * Field name patterns that should be redacted
 */
const sensitiveFields = [
  /email/i,
  /phone/i,
  /password/i,
  /token/i,
  /api[-_]?key/i,
  /credit[-_]?card/i,
  /ssn/i,
  /passport/i,
  /secret/i,
  /authorization/i,
  /auth/i,
  /lastname/i,
  /address/i,
  /ipaddress/i,
  /ip_address/i,
];

/**
 * Determine if a field should be redacted based on name or pattern
 */
function isSensitiveField(fieldName: string): keyof typeof redactionRules | null {
  for (const pattern of sensitiveFields) {
    if (pattern.test(fieldName)) {
      // Match to redaction rule
      if (/email/i.test(fieldName)) return 'email';
      if (/phone/i.test(fieldName)) return 'phone';
      if (/password/i.test(fieldName)) return 'password';
      if (/token|secret|key/i.test(fieldName)) return 'apiKey';
      if (/credit[-_]?card/i.test(fieldName)) return 'creditCard';
      if (/ssn/i.test(fieldName)) return 'ssn';
      if (/passport/i.test(fieldName)) return 'passport';
      if (/address/i.test(fieldName)) return 'address';
      if (/ip|address/i.test(fieldName) && /ip/i.test(fieldName)) return 'ipAddress';
      return 'apiKey'; // Default for auth-like fields
    }
  }
  return null;
}

/**
 * Recursively redact sensitive data in an object
 */
export function redactPII(obj: any, depth: number = 0): any {
  // Prevent deep recursion
  if (depth > 10) return '[REDACTED - too deep]';

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactPII(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const redacted: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const sensitiveRule = isSensitiveField(key);
      if (sensitiveRule && value) {
        redacted[key] = redactionRules[sensitiveRule](String(value));
      } else if (typeof value === 'object') {
        redacted[key] = redactPII(value, depth + 1);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  return obj;
}

/**
 * Redact a user agent string (removes OS version details)
 */
export function redactUserAgent(userAgent: string): string {
  if (!userAgent) return 'unknown';
  // Keep browser/framework info, remove detailed OS info
  return userAgent
    .replace(/Windows NT \d+\.\d+/gi, 'Windows')
    .replace(/Mac OS X [\d_]+/gi, 'macOS')
    .replace(/Android \d+/gi, 'Android')
    .replace(/iPhone OS \d+/gi, 'iOS')
    .slice(0, 100); // Cap at 100 chars
}

/**
 * Redact an IP address
 */
export function redactIp(ip: string): string {
  if (!ip) return 'unknown';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
  }
  // IPv6 or other format
  return ip.slice(0, 10) + '...';
}

/**
 * Keep request analytics useful without persisting credentials or attribution
 * values that arrived in a URL query string or fragment.
 */
export function sanitizeRequestLogPath(rawUrl: unknown): string {
  const raw = String(rawUrl || "/").trim();
  if (!raw) return "/";

  try {
    const parsed = new URL(raw, "https://request-log.invalid");
    return parsed.pathname || "/";
  } catch {
    const pathname = raw.split(/[?#]/, 1)[0]?.trim();
    return pathname?.startsWith("/") ? pathname : "/";
  }
}

/**
 * Referrers can contain password-reset, verification, OAuth, and campaign
 * values. Retain only the origin and pathname needed for traffic reporting.
 */
export function sanitizeRequestLogReferrer(rawReferrer: unknown): string | null {
  const raw = String(rawReferrer || "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.origin}${parsed.pathname || "/"}`;
  } catch {
    return null;
  }
}

/**
 * Create an audit log entry with redacted data
 */
export function createRedactedAuditEntry(entry: {
  action: string;
  userId: string;
  resourceType: string;
  resourceId: string;
  ip: string;
  userAgent: string;
  metadata: Record<string, any>;
}) {
  return {
    action: entry.action,
    userId: entry.userId,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    ip: redactIp(entry.ip),
    userAgent: redactUserAgent(entry.userAgent),
    metadata: redactPII(entry.metadata),
  };
}
