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

/**
 * Normalize a raw unit string to a canonical form.
 * - Trims and uppercases
 * - Removes common prefixes (APT, APARTMENT, UNIT, #, etc.)
 * - Converts separators (12-B → 12B, 12 B → 12B)
 * - Removes punctuation except letters/numbers
 * - Returns null for junk values
 */
export function normalizeUnit(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  
  // Trim and uppercase
  let value = String(raw).trim().toUpperCase();
  
  // Check junk values early
  if (JUNK_VALUES.has(value)) return null;
  
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
  
  return value;
}

/**
 * Fields to check for unit information in order of priority.
 * These cover common field names across HPD, 311, and other NYC datasets.
 */
const UNIT_FIELDS = [
  'apartment',
  'apt',
  'apt_no',
  'apartment_number',
  'apartmentnumber',
  'unit',
  'unit_number',
  'unitnumber',
  'housenumber_unit',
  'address_unit',
  'apartment_unit',
  'bbl_unit',
  'apt_number',
  'suite',
  'room',
  'floor_unit',
  // HPD-specific
  'lowhousenumber',  // Sometimes contains unit info
  // 311-specific
  'incident_address', // May contain unit in address string
];

/**
 * Extract and normalize a unit from a record by checking common field names.
 * Returns null if no unit can be found or it's a junk value.
 */
export function extractUnitFromRecord(record: Record<string, unknown> | null | undefined): string | null {
  if (!record) return null;
  
  // Check each field in priority order
  for (const field of UNIT_FIELDS) {
    const value = record[field];
    if (value != null && value !== '') {
      const normalized = normalizeUnit(String(value));
      if (normalized) return normalized;
    }
  }
  
  // Special case: try to extract unit from address string if present
  const addressFields = ['incident_address', 'address', 'full_address', 'location'];
  for (const field of addressFields) {
    const address = record[field];
    if (typeof address === 'string') {
      const unit = extractUnitFromAddress(address);
      if (unit) return unit;
    }
  }
  
  return null;
}

/**
 * Try to extract a unit from an address string.
 * Looks for patterns like "123 Main St Apt 4B" or "123 Main St #4B"
 */
function extractUnitFromAddress(address: string): string | null {
  if (!address) return null;
  
  const upperAddress = address.toUpperCase();
  
  // Pattern: "APT 4B", "UNIT 4B", "#4B", "SUITE 100"
  const patterns = [
    /(?:APT\.?|APARTMENT|UNIT|#|SUITE|STE\.?)\s*([A-Z0-9]+(?:[A-Z0-9\-]*[A-Z0-9])?)/i,
    /,\s*#?([A-Z0-9]+(?:[A-Z0-9\-]*[A-Z0-9])?)$/i,  // Trailing unit after comma
  ];
  
  for (const pattern of patterns) {
    const match = upperAddress.match(pattern);
    if (match && match[1]) {
      const normalized = normalizeUnit(match[1]);
      if (normalized) return normalized;
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
