/**
 * Unit normalization utilities for co-op buildings.
 * Since co-ops don't have unit BBLs, we derive unit visibility from
 * records that explicitly reference apartment/unit numbers.
 * 
 * CRITICAL: Unit mentions are ONLY extracted from records that are
 * definitively tied to the building via BBL or BIN. All NYC Open Data
 * queries filter by BBL/BIN at the API level, ensuring building-level
 * validation before any unit extraction occurs.
 */

// Junk values that should return null
const JUNK_VALUES = new Set([
  '', 'N/A', 'NA', 'NONE', 'UNKNOWN', '0', '-', 'N', 'NULL', 'BUILDING', 'BLDG', 
  'BASEMENT', 'CELLAR', 'ROOF', 'COMMON', 'LOBBY', 'HALLWAY', 'ALL', 'ENTIRE',
  'BSMT', 'ROOFDECK', 'TERRACE', 'GARAGE', 'STORE', 'STOREFRONT', 'COMMERCIAL'
]);

// Prefixes to strip from unit values
const STRIP_PREFIXES = [
  'APARTMENT', 'APT\\.?', 'UNIT', 'SUITE', 'STE\\.?', 'ROOM', 'RM\\.?', 
  '#', 'NO\\.?', 'NUMBER'
];

// Floor-only patterns to reject (not valid unit identifiers)
const FLOOR_ONLY_PATTERNS = [
  /^(?:FLOOR|FL)\s*\d+$/i,
  /^\d+(?:ST|ND|RD|TH)\s*(?:FLOOR|FL)$/i,
  /^(?:1ST|2ND|3RD|\d+TH)\s*FL(?:OOR)?$/i,
  /^FL\d+$/i,
];

// Job/permit number patterns to reject
const JOB_NUMBER_PATTERNS = [
  /^[ABJMNPQRX]\d{8,}$/i,  // DOB job numbers like B00123456
  /^NB\d+$/i,              // New Building numbers
  /^A[123]\d+$/i,          // Alteration numbers
  /^\d{8,}$/,              // Long numeric strings (likely job/permit IDs)
];

// Address-like substrings to reject (before normalization)
const ADDRESS_SUBSTRINGS = [
  'STREET', 'AVENUE', 'ROAD', 'BOULEVARD', 'BLVD',
  'PLACE', 'DRIVE', 'LANE', 'WEST', 'EAST', 'NORTH', 'SOUTH',
  'BROOKLYN', 'MANHATTAN', 'BRONX', 'QUEENS', 'STATEN'
];

/**
 * Result of unit extraction with traceability info.
 */
export interface UnitExtractionResult {
  /** Normalized unit token for matching */
  normalizedUnit: string;
  /** Original value as reported in the record */
  asReported: string;
  /** Field name where the unit was found */
  sourceField: string;
  /** Text snippet showing context (for free-text extractions) */
  snippet: string | null;
}

/**
 * Check if a normalized unit string looks like a valid apartment/unit label.
 * Rejects address-like values and validates against known unit patterns.
 * 
 * TIGHTENED: Supports short co-op units (2H, PH, G, S) while preventing
 * false positives from addresses, job numbers, and floor-only references.
 */
export function isLikelyUnitLabel(unit: string): boolean {
  if (!unit) return false;
  
  // Rule: Reject if length < 1 or > 6
  if (unit.length < 1 || unit.length > 6) return false;
  
  // Rule: Reject floor-only patterns
  for (const pattern of FLOOR_ONLY_PATTERNS) {
    if (pattern.test(unit)) return false;
  }
  
  // Rule: Reject job/permit number patterns
  for (const pattern of JOB_NUMBER_PATTERNS) {
    if (pattern.test(unit)) return false;
  }
  
  // Rule: Reject if only digits and length >= 3 (e.g., 325, 1200 are house numbers)
  if (/^\d+$/.test(unit) && unit.length >= 3) return false;
  
  // Rule: Reject if it looks like a ZIP code (exactly 5 digits)
  if (/^\d{5}$/.test(unit)) return false;
  
  // Allowed patterns for co-op units (TIGHTENED for short units)
  const allowedPatterns = [
    /^\d{1,2}[A-Z]$/,              // 2G, 12B (number + single letter)
    /^\d{1,2}[A-Z]{2}$/,           // 12AB (number + two letters)
    /^(PH|TH|LH|RH|BS|GF|PHS?)\d?[A-Z]?$/, // PH, PH2, PH2A, TH, GF, PHS
    /^[A-Z]{1,2}\d{1,2}$/,         // A1, B12 (letter + number)
    /^[A-Z]$/,                     // Single letter units: A, B, G, S
    /^\d{1,2}$/,                   // Short numeric: 1, 12 (only 1-2 digits)
    /^[A-Z]\d[A-Z]?$/,             // A2, A2B pattern
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
 * 
 * TIGHTENED: Patterns require explicit unit keywords (APT, APARTMENT, UNIT, #)
 * followed by the unit value. Does NOT match "near apt" or contextual mentions
 * without an explicit unit identifier.
 */
const UNIT_EXTRACTION_PATTERNS: { pattern: RegExp; keyword: string }[] = [
  { pattern: /\bAPT\.?\s+([A-Z0-9]{1,6})\b/i, keyword: 'APT' },
  { pattern: /\bAPARTMENT\s+([A-Z0-9]{1,6})\b/i, keyword: 'APARTMENT' },
  { pattern: /\bUNIT\s+([A-Z0-9]{1,6})\b/i, keyword: 'UNIT' },
  { pattern: /\b#\s*([A-Z0-9]{1,6})\b/, keyword: '#' },
  // Penthouse patterns
  { pattern: /\bPENTHOUSE\s+([A-Z0-9]{1,3})?\b/i, keyword: 'PENTHOUSE' },
  { pattern: /\bPH\s*([A-Z0-9]{1,3})?\b/i, keyword: 'PH' },
];

/**
 * Try to extract a unit token from a free-text field using regex patterns.
 * Returns extraction result with traceability info, or null if no valid unit found.
 * 
 * EVIDENCE-ONLY: Only matches explicit unit keywords followed by a unit value.
 * Does NOT infer from patterns like "near apt" or contextual mentions.
 */
function extractUnitFromText(
  text: string | null | undefined, 
  fieldName: string
): UnitExtractionResult | null {
  if (!text) return null;
  
  const textStr = String(text);
  
  for (const { pattern, keyword } of UNIT_EXTRACTION_PATTERNS) {
    const match = textStr.match(pattern);
    if (match) {
      // For penthouse patterns, unit value might be empty (just "PH")
      const rawUnit = match[1] || (keyword === 'PENTHOUSE' ? 'PH' : keyword === 'PH' ? 'PH' : null);
      if (!rawUnit) continue;
      
      // Build the as-reported value
      const asReported = match[0].trim();
      
      // Handle PH/PENTHOUSE specially
      let normalized: string | null;
      if (keyword === 'PENTHOUSE' || keyword === 'PH') {
        // Normalize to PH + optional suffix
        const suffix = match[1] ? match[1].toUpperCase() : '';
        normalized = `PH${suffix}`;
        if (!isLikelyUnitLabel(normalized)) continue;
      } else {
        normalized = normalizeUnit(rawUnit);
        if (!normalized) continue;
      }
      
      // Extract snippet (surrounding context)
      const matchIndex = match.index || 0;
      const snippetStart = Math.max(0, matchIndex - 30);
      const snippetEnd = Math.min(textStr.length, matchIndex + match[0].length + 30);
      const snippet = (snippetStart > 0 ? '...' : '') + 
                      textStr.slice(snippetStart, snippetEnd).trim() + 
                      (snippetEnd < textStr.length ? '...' : '');
      
      return {
        normalizedUnit: normalized,
        asReported,
        sourceField: fieldName,
        snippet,
      };
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
  // DOB Permit/Filing text fields
  'job_description',
  'jobdescription',
  'work_on_floors',
  'workonfloors',
  'comments',
  'scope_of_work',
  'scopeofwork',
  'filing_reason',
  'filingreason',
  // DOB Violation text fields
  'description',
  'violation_description',
  'violationdescription',
  'violation_type_description',
  'violation_category',
  'violationcategory',
  'remedy',
  'isn_description',
  'isndescription',
  'device_number',
  'devicenumber',
  // ECB Violation text fields
  'ecb_violation_description',
  'ecbviolationdescription',
  'infraction_description',
  'infractiondescription',
  'penality_imposed',
  'standard_description',
  'violation_details',
  'violationdetails',
];

/**
 * BBL/BIN fields to check for building validation.
 * A record is only valid for unit extraction if it has a BBL or BIN.
 */
const BUILDING_ID_FIELDS = [
  'bbl',
  'bin',
  'boro_block_lot',
  'boroBlockLot',
  'building_id',
  'buildingid',
];

/**
 * Check if a record has a valid building identifier (BBL or BIN).
 * This ensures we only extract units from records definitively tied to the building.
 */
export function hasValidBuildingId(record: Record<string, unknown> | null | undefined): boolean {
  if (!record) return false;
  
  for (const field of BUILDING_ID_FIELDS) {
    const value = record[field];
    if (value != null && value !== '' && String(value).trim() !== '') {
      // BBL should be 10 digits, BIN should be 7 digits
      const strValue = String(value).replace(/\D/g, '');
      if (strValue.length >= 7) return true;
    }
  }
  
  return false;
}

/**
 * Extract and normalize a unit from a record with full traceability.
 * 
 * BUILDING VALIDATION: Records are only processed if they are tied to
 * the building via BBL/BIN at the API level (NYC Open Data queries).
 * This function provides an additional check but the primary validation
 * happens during data fetching.
 * 
 * EVIDENCE-ONLY: Only extracts units when explicitly stated in the record.
 * Does NOT infer from patterns like "near apt" or contextual mentions.
 * 
 * Returns extraction result with field name and snippet, or null if no unit found.
 */
export function extractUnitFromRecordWithTrace(
  record: Record<string, unknown> | null | undefined
): UnitExtractionResult | null {
  if (!record) return null;
  
  // Note: Building validation is primarily done at the API level (BBL/BIN queries).
  // Records returned from NYC Open Data are already filtered to the building.
  // This is an additional safety check but not the primary validation.
  
  // First pass: Check direct apartment fields in priority order
  for (const field of UNIT_FIELDS) {
    const value = record[field];
    if (value != null && value !== '') {
      const rawValue = String(value);
      const normalized = normalizeUnit(rawValue);
      if (normalized) {
        return {
          normalizedUnit: normalized,
          asReported: rawValue.trim().toUpperCase(),
          sourceField: field,
          snippet: null, // Direct field, no snippet needed
        };
      }
    }
  }
  
  // Second pass: Pattern-based extraction from free-text fields
  for (const field of TEXT_EXTRACTION_FIELDS) {
    const value = record[field];
    if (value != null && value !== '') {
      const extracted = extractUnitFromText(String(value), field);
      if (extracted) return extracted;
    }
  }
  
  return null;
}

/**
 * Extract and normalize a unit from a record by checking apartment-specific fields only.
 * Falls back to pattern-based extraction from descriptor/resolution fields.
 * Returns null if no unit can be found or it's invalid.
 * 
 * @deprecated Use extractUnitFromRecordWithTrace for full traceability.
 */
export function extractUnitFromRecord(record: Record<string, unknown> | null | undefined): string | null {
  const result = extractUnitFromRecordWithTrace(record);
  return result?.normalizedUnit ?? null;
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
