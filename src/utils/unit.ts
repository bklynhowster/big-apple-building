/**
 * Unit normalization utilities for co-op buildings.
 * Since co-ops don't have unit BBLs, we derive unit visibility from
 * records that explicitly reference apartment/unit numbers.
 */

// Junk values that should return null
const JUNK_VALUES = new Set([
  '', 'N/A', 'NA', 'NONE', 'UNKNOWN', '0', '-', 'N', 'NULL', 'BUILDING', 'BLDG', 
  'BASEMENT', 'CELLAR', 'ROOF', 'COMMON', 'LOBBY', 'HALLWAY'
]);

// Prefixes to strip from unit values
const STRIP_PREFIXES = [
  'APARTMENT', 'APT\\.?', 'UNIT', 'SUITE', 'STE\\.?', 'ROOM', 'RM\\.?', 
  'FLOOR', 'FL\\.?', '#', 'NO\\.?', 'NUMBER'
];

// Address-like substrings to reject (before normalization)
const ADDRESS_SUBSTRINGS = [
  'STREET', 'ST', 'AVENUE', 'AVE', 'ROAD', 'RD', 'BOULEVARD', 'BLVD',
  'PLACE', 'PL', 'DRIVE', 'DR', 'LANE', 'LN', 'WEST', 'EAST', 'NORTH', 'SOUTH'
];

/**
 * Check if a normalized unit string looks like a valid apartment/unit label.
 * Rejects address-like values and validates against known unit patterns.
 */
export function isLikelyUnitLabel(unit: string): boolean {
  if (!unit) return false;
  
  // Rule: Reject if length < 1 or > 6
  if (unit.length < 1 || unit.length > 6) return false;
  
  // Rule: Reject if only digits and length >= 3 (e.g., 325, 1200 are house numbers)
  if (/^\d+$/.test(unit) && unit.length >= 3) return false;
  
  // Rule: Reject if it looks like a ZIP code (exactly 5 digits)
  if (/^\d{5}$/.test(unit)) return false;
  
  // Allowed patterns (check these first for valid units)
  const allowedPatterns = [
    /^\d{1,2}[A-Z]?$/,           // 1, 12, 12B
    /^\d{1,2}[A-Z]{1,2}$/,       // 12AB
    /^(PH|TH|LH|RH|BS|GF)\d?[A-Z]?$/, // PH, PH2, PH2A, TH, GF
    /^[A-Z]{1,2}\d{1,2}$/,       // A1, B12
    /^\d?[A-Z]{1,2}$/,           // A, 2A, AA
  ];
  
  return allowedPatterns.some(pattern => pattern.test(unit));
}

/**
 * Check if the raw (pre-normalization) value contains address-like substrings.
 */
function containsAddressSubstring(raw: string): boolean {
  const upper = raw.toUpperCase();
  return ADDRESS_SUBSTRINGS.some(substr => {
    // Use word boundary-like matching to avoid false positives
    // e.g., "EAST" should match but not part of another word
    const regex = new RegExp(`\\b${substr}\\b`, 'i');
    return regex.test(upper);
  });
}

/**
 * Normalize a raw unit string to a canonical form.
 * - Trims and uppercases
 * - Removes common prefixes (APT, APARTMENT, UNIT, #, etc.)
 * - Converts separators (12-B → 12B, 12 B → 12B)
 * - Removes punctuation except letters/numbers
 * - Returns null for junk values or address-like values
 */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  
  // Trim and uppercase
  let value = String(raw).trim().toUpperCase();
  
  // Check junk values early
  if (JUNK_VALUES.has(value)) return null;
  
  // Reject if contains address-like substrings (before stripping prefixes)
  if (containsAddressSubstring(value)) return null;
  
  // Strip common prefixes (with optional spaces/punctuation after)
  const prefixPattern = new RegExp(`^(${STRIP_PREFIXES.join('|')})\\s*[:\\-\\.\\s]*`, 'i');
  value = value.replace(prefixPattern, '');
  
  // Remove all whitespace, hyphens, and common separators between characters
  // e.g., "12-B" → "12B", "12 B" → "12B", "12.B" → "12B"
  value = value.replace(/[\s\-\.]+/g, '');
  
  // Remove any remaining punctuation except alphanumeric
  value = value.replace(/[^A-Z0-9]/g, '');
  
  // Final junk check after normalization
  if (!value || JUNK_VALUES.has(value)) return null;
  
  // Additional validation: must contain at least one letter or digit
  if (!/[A-Z0-9]/.test(value)) return null;
  
  // Validate against unit label patterns
  if (!isLikelyUnitLabel(value)) return null;
  
  return value;
}

/**
 * Fields to check for unit information in order of priority.
 * RESTRICTED to apartment-specific fields only - no address fields.
 */
const UNIT_FIELDS = [
  'apartment',
  'apt',
  'apt_no',
  'apartment_number',
  'apartmentnumber',
  'apartmentno',
  'apt_num',
  'apt_number',
  'unit',
  'unit_number',
  'unitnumber',
];

/**
 * Regex patterns to extract unit tokens from free-text fields.
 * Each pattern has a capture group for the unit value.
 */
const UNIT_EXTRACTION_PATTERNS = [
  /\bAPT\.?\s*([A-Z0-9]{1,6})\b/i,
  /\bAPARTMENT\s*([A-Z0-9]{1,6})\b/i,
  /\bUNIT\s*([A-Z0-9]{1,6})\b/i,
  /\b#\s*([A-Z0-9]{1,6})\b/i,
  /\bRM\.?\s*([A-Z0-9]{1,6})\b/i,
  /\bROOM\s*([A-Z0-9]{1,6})\b/i,
];

/**
 * Try to extract a unit token from a free-text field using regex patterns.
 * Returns null if no valid unit found.
 */
function extractUnitFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  
  for (const pattern of UNIT_EXTRACTION_PATTERNS) {
    const match = String(text).match(pattern);
    if (match && match[1]) {
      const normalized = normalizeUnit(match[1]);
      if (normalized) return normalized;
    }
  }
  
  return null;
}

/**
 * Free-text fields to check for pattern-based unit extraction (lower priority).
 * These are used only if direct apartment fields don't yield a unit.
 */
const TEXT_EXTRACTION_FIELDS = [
  'descriptor',
  'resolution_description',
  'complaint_type',
  'problem_description',
  'minorcat',
  'spacetype',
];

/**
 * Extract and normalize a unit from a record by checking apartment-specific fields only.
 * Falls back to pattern-based extraction from descriptor/resolution fields.
 * Returns null if no unit can be found or it's invalid.
 */
export function extractUnitFromRecord(record: Record<string, unknown> | null | undefined): string | null {
  if (!record) return null;
  
  // First pass: Check direct apartment fields in priority order
  for (const field of UNIT_FIELDS) {
    const value = record[field];
    if (value != null && value !== '') {
      const normalized = normalizeUnit(String(value));
      if (normalized) return normalized;
    }
  }
  
  // Second pass: Pattern-based extraction from free-text fields
  for (const field of TEXT_EXTRACTION_FIELDS) {
    const value = record[field];
    if (value != null && value !== '') {
      const extracted = extractUnitFromText(String(value));
      if (extracted) return extracted;
    }
  }
  
  return null;
}

/**
 * Group records by their extracted unit.
 * Returns a Map where keys are normalized unit strings and values are arrays of records.
 * Records with no extractable unit are grouped under null key.
 */
export function groupRecordsByUnit<T extends Record<string, unknown>>(
  records: T[]
): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  
  for (const record of records) {
    const unit = extractUnitFromRecord(record);
    const existing = groups.get(unit) || [];
    existing.push(record);
    groups.set(unit, existing);
  }
  
  return groups;
}

/**
 * Get aggregate unit stats from a collection of records.
 * Returns an array of { unit, count, lastActivity } sorted by count descending.
 */
export interface UnitStats {
  unit: string;
  count: number;
  lastActivity: Date | null;
}

export function getUnitStats<T extends Record<string, unknown>>(
  records: T[],
  dateField: string = 'issueDate'
): UnitStats[] {
  const groups = groupRecordsByUnit(records);
  const stats: UnitStats[] = [];
  
  for (const [unit, groupRecords] of groups.entries()) {
    // Skip null (building-wide) records
    if (!unit) continue;
    
    // Find max date
    let maxDate: Date | null = null;
    for (const record of groupRecords) {
      const dateValue = record[dateField] as string | null | undefined;
      if (dateValue) {
        const date = new Date(dateValue);
        if (!isNaN(date.getTime())) {
          if (!maxDate || date > maxDate) {
            maxDate = date;
          }
        }
      }
    }
    
    stats.push({
      unit,
      count: groupRecords.length,
      lastActivity: maxDate,
    });
  }
  
  // Sort by count descending, then by unit alphanumerically
  return stats.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.unit.localeCompare(b.unit, undefined, { numeric: true });
  });
}

/**
 * Filter records to only those matching a specific unit context.
 */
export function filterRecordsByUnit<T extends Record<string, unknown>>(
  records: T[],
  unitContext: string | null
): T[] {
  if (!unitContext) return records;
  
  const normalizedContext = normalizeUnit(unitContext);
  if (!normalizedContext) return records;
  
  return records.filter(record => {
    const recordUnit = extractUnitFromRecord(record);
    return recordUnit === normalizedContext;
  });
}
