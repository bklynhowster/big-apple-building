/**
 * Unit Mention Matching Utility
 * 
 * Provides robust text matching to detect if a record explicitly mentions
 * a specific unit/apartment in its free-text fields.
 */

/**
 * Builds a regex pattern that matches various unit label formats.
 * 
 * For "1A" → matches: "1A", "Unit 1A", "Apt 1A", "Apartment 1A", "#1A", "Apt. 1A"
 * For "2C" → matches: "2C", "Unit 2C", "Apt 2C", etc.
 * For "PH" → matches: "PH", "Penthouse", "Unit PH"
 * 
 * @param unitLabel The unit label to match (e.g., "1A", "2C", "PH", "3")
 * @returns RegExp pattern for matching
 */
export function buildUnitRegex(unitLabel: string): RegExp {
  if (!unitLabel) return /(?!)/; // Never matches
  
  const normalized = unitLabel.trim().toUpperCase();
  
  // Escape special regex characters
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Common prefixes for unit references
  const prefixes = [
    'unit',
    'apt\\.?',
    'apartment',
    '#',
    'suite',
    'ste\\.?',
    'fl\\.?',
    'floor',
    'rm\\.?',
    'room',
  ];
  
  // Build pattern: optional prefix + optional space + unit label + word boundary
  // This matches: "Unit 1A", "Apt 1A", "1A", "#1A", etc.
  const prefixPattern = `(?:(?:${prefixes.join('|')})\\s*)?`;
  
  // For purely numeric units like "1", we need to be more careful to avoid
  // matching random numbers. Require a prefix or specific context.
  const isNumericOnly = /^\d+$/.test(normalized);
  
  if (isNumericOnly) {
    // For numeric-only units, require a prefix to avoid false positives
    const strictPrefixPattern = `(?:${prefixes.join('|')})\\s*`;
    return new RegExp(`\\b${strictPrefixPattern}${escaped}\\b`, 'gi');
  }
  
  // For alphanumeric units (1A, 2C, PH), the pattern is more flexible
  return new RegExp(`\\b${prefixPattern}${escaped}\\b`, 'gi');
}

/**
 * Dataset-specific field mappings for text extraction.
 * Each dataset has different fields that may contain unit references.
 */
const DATASET_TEXT_FIELDS: Record<string, string[]> = {
  // DOB Violations
  'dob-violation': [
    'description',
    'violationdescription',
    'violation_description',
    'novdescription',
    'nov_description',
    'disposition',
    'comments',
    'location',
    'violationlocation',
    'apartment',
    'apt',
    'unit',
    'story',
    'floor',
  ],
  // ECB Violations
  'ecb': [
    'description',
    'violation_description',
    'infraction_description',
    'penalty_description',
    'comments',
    'disposition',
    'location',
    'unit',
    'apartment',
  ],
  // HPD Violations
  'hpd-violation': [
    'novdescription',
    'nov_description',
    'violation_description',
    'violationdescription',
    'description',
    'story',
    'apartment',
    'apt',
    'unit',
    'location',
  ],
  // HPD Complaints
  'hpd-complaint': [
    'complainttype',
    'complaint_type',
    'status',
    'description',
    'apartment',
    'unit',
    'story',
    'location',
  ],
  // DOB Permits
  'permit': [
    'job_description',
    'jobdescription',
    'work_type',
    'worktype',
    'job_type',
    'filing_reason',
    'owner_business_name',
    'applicant_business_name',
    'apartment',
    'unit',
    'location',
  ],
  // Safety
  'safety': [
    'description',
    'complaint_category',
    'disposition',
    'comments',
    'location',
  ],
  // Generic fallback
  'default': [
    'description',
    'comments',
    'location',
    'apartment',
    'unit',
    'story',
    'floor',
    'disposition',
    'violation_description',
    'novdescription',
  ],
};

/**
 * Extracts all relevant text from a record for unit mention matching.
 * 
 * @param record The record object (should have a `raw` property with original API data)
 * @param datasetType Optional dataset type for field-specific extraction
 * @returns Combined text from all relevant fields
 */
export function extractRecordText(
  record: { raw?: Record<string, unknown> } & Record<string, unknown>,
  datasetType?: string
): string {
  const raw = record.raw || record;
  const fields = DATASET_TEXT_FIELDS[datasetType || 'default'] || DATASET_TEXT_FIELDS.default;
  
  const textParts: string[] = [];
  
  // Check all relevant fields (case-insensitive key matching)
  const rawLower: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    rawLower[key.toLowerCase()] = raw[key];
  }
  
  for (const field of fields) {
    const value = rawLower[field.toLowerCase()];
    if (typeof value === 'string' && value.trim()) {
      textParts.push(value);
    }
  }
  
  // Also check the top-level record properties
  for (const field of fields) {
    const value = (record as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.trim() && !textParts.includes(value)) {
      textParts.push(value);
    }
  }
  
  return textParts.join(' ');
}

/**
 * Checks if a record's text fields mention a specific unit.
 * 
 * @param record The record to check
 * @param unitLabel The unit label to search for
 * @param datasetType Optional dataset type for field-specific extraction
 * @returns true if the record mentions the unit
 */
export function matchesUnitMention(
  record: { raw?: Record<string, unknown> } & Record<string, unknown>,
  unitLabel: string,
  datasetType?: string
): boolean {
  if (!unitLabel) return false;
  
  const text = extractRecordText(record, datasetType);
  if (!text) return false;
  
  const regex = buildUnitRegex(unitLabel);
  return regex.test(text);
}

/**
 * Filters an array of records to only those mentioning a specific unit.
 * 
 * @param records Array of records to filter
 * @param unitLabel The unit label to filter by
 * @param datasetType Optional dataset type for field-specific extraction
 * @returns Filtered array of records that mention the unit
 */
export function filterRecordsByUnitMention<T extends { raw?: Record<string, unknown> }>(
  records: T[],
  unitLabel: string,
  datasetType?: string
): T[] {
  if (!unitLabel || !records.length) return [];
  
  return records.filter(record => matchesUnitMention(record, unitLabel, datasetType));
}

/**
 * Counts how many records in an array mention a specific unit.
 * 
 * @param records Array of records to check
 * @param unitLabel The unit label to search for
 * @param datasetType Optional dataset type for field-specific extraction
 * @returns Count of matching records
 */
export function countUnitMentions<T extends { raw?: Record<string, unknown> }>(
  records: T[],
  unitLabel: string,
  datasetType?: string
): number {
  if (!unitLabel || !records.length) return 0;
  
  return records.filter(record => matchesUnitMention(record, unitLabel, datasetType)).length;
}
