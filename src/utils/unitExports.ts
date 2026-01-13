/**
 * src/utils/unitExports.ts
 * 
 * A stable export surface to prevent runtime "Importing binding name X is not found" failures.
 * Do NOT change implementation here—only re-export what already exists in ./unit.
 */

export type {
  UnitType,
  UnitConfidence,
  UnitExtractionResult,
  UnitStats,
} from './unit';

export {
  // core validation/normalization
  isStopword,
  isLikelyUnitLabel,
  normalizeUnit,

  // extraction
  extractUnitCandidatesFromText,
  extractUnitFromRecordWithTrace,
  extractUnitFromRecord,

  // aggregation / helpers used across the app
  groupRecordsByUnit,
  getUnitStats,
  filterRecordsByUnit,
  recordMentionsUnit,
} from './unit';

// Compile-time tripwire: If unit.ts ever stops exporting one of these, TypeScript will fail the build here.
const _exportTripwire = {
  isStopword: true,
  isLikelyUnitLabel: true,
  normalizeUnit: true,
  extractUnitFromRecordWithTrace: true,
  extractUnitCandidatesFromText: true,
  filterRecordsByUnit: true,
  recordMentionsUnit: true,
};
void _exportTripwire;
