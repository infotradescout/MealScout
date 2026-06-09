type ParsedTruckRow = {
  externalId?: string | null;
  email?: string | null;
  name?: string | null;
  address?: string | null;
  businessAdminAddress?: string | null;
  operatingLocationAddress?: string | null;
  serviceArea?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  cuisineType?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookPageUrl?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  confidenceScore?: number;
  rawData: Record<string, string>;
};

const FIELD_ALIASES: Record<string, string[]> = {
  externalId: [
    "license",
    "license id",
    "license number",
    "license #",
    "license no",
    "license no.",
    "licence",
    "licence id",
    "licence number",
    "permit",
    "permit id",
    "permit number",
    "permit no",
    "permit no.",
    "registration",
    "registration id",
    "registry id",
    "business id",
    "id",
  ],
  email: ["email", "e-mail", "contact email", "owner email", "business email"],
  // "Business name" varies wildly across exports (DBA, trade name, establishment, etc).
  name: [
    "name",
    "business name",
    "business",
    "company",
    "company name",
    "vendor name",
    "vendor",
    "truck name",
    "establishment",
    "establishment name",
    "restaurant",
    "restaurant name",
    "legal name",
    "trade name",
    "dba",
    "doing business as",
  ],
  address: [
    "address",
    "street",
    "street address",
    "address1",
    "address 1",
  ],
  businessAdminAddress: [
    "business address",
    "admin address",
    "administrative address",
    "static address",
    "mailing address",
    "billing address",
    "menu address",
    "business/admin address",
  ],
  operatingLocationAddress: [
    "operating location",
    "operating address",
    "location address",
    "scheduled stop",
    "schedule stop",
    "stop address",
    "event location",
    "live location",
    "current location",
  ],
  serviceArea: [
    "service area",
    "market",
    "primary market",
    "serving area",
    "coverage area",
  ],
  city: ["city", "town", "municipality"],
  state: ["state", "st", "st.", "province", "region"],
  phone: [
    "phone",
    "phone number",
    "telephone",
    "tel",
    "contact phone",
    "business phone",
  ],
  cuisineType: ["cuisine", "category", "type"],
  websiteUrl: ["website", "website url", "url", "site", "web", "homepage"],
  instagramUrl: ["instagram", "instagram url", "ig", "ig url", "insta"],
  facebookPageUrl: ["facebook", "facebook url", "fb", "fb url", "facebook page"],
  latitude: ["lat", "latitude"],
  longitude: ["lng", "longitude", "lon"],
};

const normalizeHeader = (value: string): string =>
  value
    // Handle camelCase/PascalCase exports like "BusinessName".
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const mapHeaderToField = (header: string): string | null => {
  const normalized = normalizeHeader(header);
  const compact = normalized.replace(/\s+/g, "");
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    // Match full words/phrases within the header (more robust than exact-equals,
    // avoids false positives like "username" matching "name").
    const hay = ` ${normalized} `;
    if (aliases.some((alias) => hay.includes(` ${normalizeHeader(alias)} `))) {
      return field;
    }
    // Some exports drop separators entirely ("businessname"). Allow a compact match
    // only for multi-word aliases to reduce false positives.
    const hasCompactMatch = aliases.some((alias) => {
      const aliasNormalized = normalizeHeader(alias);
      if (!aliasNormalized.includes(" ")) return false;
      const aliasCompact = aliasNormalized.replace(/\s+/g, "");
      return aliasCompact.length >= 6 && compact.includes(aliasCompact);
    });
    if (hasCompactMatch) return field;
  }
  return null;
};

const parseDelimitedToRows = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && (char === delimiter || char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(value);
      value = "";
      if (char === "\n" || char === "\r") {
        if (row.some((cell) => cell.trim() !== "")) {
          rows.push(row);
        }
        row = [];
      }
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row);
  }

  return rows;
};

const parseCsvToRows = (text: string): string[][] =>
  parseDelimitedToRows(text, ",");

const parseTsvToRows = (text: string): string[][] =>
  parseDelimitedToRows(text, "\t");

const decodeHtmlEntities = (value: string): string => {
  const input = String(value || "");
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return input
    .replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
      const text = String(entity || "");
      if (text.startsWith("#x") || text.startsWith("#X")) {
        const code = Number.parseInt(text.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (text.startsWith("#")) {
        const code = Number.parseInt(text.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      const key = text.toLowerCase();
      return key in named ? named[key] : match;
    })
    .replace(/\u00A0/g, " ");
};

const stripHtml = (value: string): string => {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr)>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
};

const parseHtmlTableToRows = (html: string): string[][] => {
  const normalized = String(html || "");
  const tableMatch = normalized.match(/<table[\s\S]*?<\/table>/i);
  const scoped = tableMatch ? tableMatch[0] : normalized;

  const rowMatches = scoped.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const rows: string[][] = [];
  for (const rowHtml of rowMatches) {
    const cellMatches = rowHtml.match(/<(td|th)[^>]*>[\s\S]*?<\/(td|th)>/gi) || [];
    const cells = cellMatches.map((cellHtml) => {
      const inner = cellHtml.replace(/^<(td|th)[^>]*>/i, "").replace(/<\/(td|th)>$/i, "");
      return stripHtml(inner);
    });
    if (cells.some((cell) => cell.trim() !== "")) {
      rows.push(cells);
    }
  }
  return rows;
};

const detectDelimiter = (text: string): string => {
  const candidates = [",", "\t", ";", "|"];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 5);
  const sample = lines.join("\n");
  if (!sample) return ",";
  const counts = candidates.map((delimiter) => ({
    delimiter,
    count: Array.from(sample).reduce(
      (sum, char) => sum + (char === delimiter ? 1 : 0),
      0,
    ),
  }));
  counts.sort((a, b) => b.count - a.count);
  // Default to comma if we can't confidently detect.
  return counts[0]?.count ? counts[0].delimiter : ",";
};

const findHeaderRowIndex = (rows: string[][]): number => {
  const scanLimit = Math.min(rows.length, 50);
  let bestIndex = 0;
  let bestScore = 0;

  for (let i = 0; i < scanLimit; i += 1) {
    const row = rows[i] || [];
    const nonEmpty = row.filter((cell) => String(cell || "").trim() !== "");
    if (nonEmpty.length === 0) continue;
    const mappedCount = nonEmpty.reduce((sum, cell) => {
      return sum + (mapHeaderToField(String(cell)) ? 1 : 0);
    }, 0);
    if (mappedCount > bestScore) {
      bestScore = mappedCount;
      bestIndex = i;
    }
  }

  // Require at least a couple of recognizable header cells; otherwise treat first row as headers.
  return bestScore >= 2 ? bestIndex : 0;
};

const buildRowData = (
  headers: string[],
  row: string[],
): ParsedTruckRow => {
  const rawData: Record<string, string> = {};
  headers.forEach((header, index) => {
    rawData[header] = row[index]?.trim() ?? "";
  });

  const mapped: ParsedTruckRow = { rawData };
  headers.forEach((header, index) => {
    const field = mapHeaderToField(header);
    if (!field) return;
    const value = row[index]?.trim();
    if (!value) return;
    (mapped as unknown as Record<string, string | null>)[field] = value;
  });

  return mapped;
};

const computeConfidenceScore = (row: ParsedTruckRow): number => {
  let score = 0;
  if (row.externalId) score += 50;
  if (row.name) score += 20;
  if (row.address) score += 15;
  if (row.phone) score += 10;
  if (row.city && row.state) score += 5;
  return Math.min(score, 100);
};

export const parseTruckImportFile = async (
  buffer: Buffer,
  fileName: string,
): Promise<{ rows: ParsedTruckRow[]; headers: string[] }> => {
  const lowerName = fileName.toLowerCase();
  let rows: string[][] = [];

  if (lowerName.endsWith(".xlsx")) {
    let ExcelJS: any;
    try {
      const imported = await import("exceljs");
      ExcelJS = (imported as any)?.default ?? imported;
    } catch {
      throw new Error("XLSX parsing requires the exceljs package.");
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return { rows: [], headers: [] };
    }

    rows = [];
    worksheet.eachRow((row: any) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(
        values.map((cell: any) => {
          if (cell == null) return "";
          if (typeof cell === "object" && "text" in cell) {
            return String(cell.text);
          }
          if (typeof cell === "object" && "richText" in cell) {
            return String(
              cell.richText?.map((part: any) => part.text).join("") || "",
            );
          }
          return String(cell);
        }),
      );
    });
  } else if (lowerName.endsWith(".xls")) {
    throw new Error(
      "Legacy .xls files are not supported. Save as .xlsx, .csv, or .tsv.",
    );
  } else {
    // Excel often exports delimited files as UTF-16LE with a BOM. Try to decode that correctly.
    const text = (() => {
      if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.toString("utf16le", 2);
      }
      if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        // Convert UTF-16BE to LE by swapping bytes.
        const swapped = Buffer.from(buffer);
        for (let i = 0; i + 1 < swapped.length; i += 2) {
          const tmp = swapped[i];
          swapped[i] = swapped[i + 1];
          swapped[i + 1] = tmp;
        }
        return swapped.toString("utf16le", 2);
      }
      if (
        buffer.length >= 3 &&
        buffer[0] === 0xef &&
        buffer[1] === 0xbb &&
        buffer[2] === 0xbf
      ) {
        return buffer.toString("utf8", 3);
      }
      return buffer.toString("utf8");
    })();

    if (lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
      rows = parseHtmlTableToRows(text);
    } else if (lowerName.endsWith(".tsv")) {
      rows = parseTsvToRows(text);
    } else {
      const delimiter = detectDelimiter(text);
      rows = parseDelimitedToRows(text, delimiter);
    }
  }

  if (rows.length === 0) {
    return { rows: [], headers: [] };
  }

  const headerIndex = findHeaderRowIndex(rows);
  const headers = (rows[headerIndex] || []).map((header, index) => {
    const trimmed = header.trim();
    // Strip BOM that can appear on the first header cell.
    return index === 0 ? trimmed.replace(/^\uFEFF/, "").trim() : trimmed;
  });
  const dataRows = rows.slice(headerIndex + 1);
  const parsedRows = dataRows
    .map((row) => buildRowData(headers, row))
    .map((row) => ({
      ...row,
      externalId: row.externalId || null,
      email: row.email || null,
      name: row.name || null,
      address: row.address || null,
      businessAdminAddress: row.businessAdminAddress || null,
      operatingLocationAddress: row.operatingLocationAddress || null,
      serviceArea: row.serviceArea || null,
      city: row.city || null,
      state: row.state || null,
      phone: row.phone || null,
      cuisineType: row.cuisineType || null,
      websiteUrl: row.websiteUrl || null,
      instagramUrl: row.instagramUrl || null,
      facebookPageUrl: row.facebookPageUrl || null,
      latitude: row.latitude || null,
      longitude: row.longitude || null,
      rawData: row.rawData,
      confidenceScore: computeConfidenceScore(row),
    }));

  return { rows: parsedRows, headers };
};
