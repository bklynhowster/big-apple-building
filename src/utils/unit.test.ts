/**
 * Unit extraction regression tests.
 * Run these to verify that common unit patterns are correctly extracted.
 * 
 * These tests validate the unit extraction logic used for "Mentioned Units"
 * in co-op buildings to ensure common apartment patterns are recognized.
 * 
 * To run in browser console: window.runUnitExtractionTests()
 */

import { 
  normalizeUnit, 
  isLikelyUnitLabel, 
  isLikelyUnitLabelRelaxed,
  extractUnitFromRecordWithTrace 
} from './unit';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const VALID_UNIT_PATTERNS = [
  // Core NYC patterns
  { input: '6M', expected: '6M' },
  { input: '6G', expected: '6G' },
  { input: '4J', expected: '4J' },
  { input: '2H', expected: '2H' },
  { input: '12B', expected: '12B' },
  { input: '100A', expected: '100A' },

  // With prefixes (should be stripped)
  { input: 'APT 6M', expected: '6M' },
  { input: 'APARTMENT 6G', expected: '6G' },
  { input: 'UNIT 4J', expected: '4J' },
  { input: '#12B', expected: '12B' },

  // Penthouse patterns
  { input: 'PH', expected: 'PH' },
  { input: 'PHH', expected: 'PHH' },

  // With separators (should be normalized)
  { input: '12-B', expected: '12B' },
  { input: '6 M', expected: '6M' },
  { input: '2.G', expected: '2G' },
];

const INVALID_UNIT_PATTERNS = [
  // False-positive narrative words
  { input: 'ONLY', reason: 'stopword' },
  { input: 'IF', reason: 'stopword' },
  { input: 'AH', reason: 'stopword' },
  { input: 'S', reason: 'single-letter weak token' },

  // Address-like values
  { input: '40 TEHAMA STREET', reason: 'address' },
  { input: 'BROOKLYN', reason: 'borough' },
  { input: '123 WEST AVENUE', reason: 'address' },

  // Job numbers
  { input: 'B00123456', reason: 'job number' },
  { input: 'NB12345', reason: 'new building number' },
  { input: 'A1234567', reason: 'alteration number' },

  // Floor-only
  { input: 'FLOOR 3', reason: 'floor only' },
  { input: '3RD FLOOR', reason: 'floor only' },
  { input: 'FL2', reason: 'floor only' },

  // Junk values
  { input: 'N/A', reason: 'junk' },
  { input: 'NONE', reason: 'junk' },
  { input: 'BUILDING', reason: 'junk' },
  { input: 'BASEMENT', reason: 'junk' },
  { input: 'CELLAR', reason: 'junk' },
  { input: 'UNKNOWN', reason: 'junk' },
  { input: '', reason: 'empty' },

  // Long numbers (4+ digits are likely addresses or house numbers)
  { input: '1200', reason: 'house number (4 digits)' },
  { input: '3250', reason: 'house number (4 digits)' },

  // ZIP codes
  { input: '11201', reason: 'zip code' },
  { input: '10001', reason: 'zip code' },
];

const RECORD_EXTRACTION_FIXTURES = [
  {
    name: 'Job description with APT mention',
    record: { job_description: 'Renovation of apartment 6M including kitchen and bath' },
    expectedUnit: '6M',
    expectedField: 'job_description',
  },
  {
    name: 'Direct apartment field',
    record: { apartment: '6M' },
    expectedUnit: '6M',
    expectedField: 'apartment',
  },
  {
    name: 'Direct apartment_no field (heuristic structured key)',
    record: { apartment_no: '6G' },
    expectedUnit: '6G',
    expectedField: 'apartment_no',
  },
  {
    name: 'HPD complaint with unit in descriptor',
    record: { descriptor: 'HEAT/HOT WATER - APT 12B - NO HEAT' },
    expectedUnit: '12B',
    expectedField: 'descriptor',
  },
  {
    name: 'Unit field with prefix',
    record: { unit: 'UNIT PHH' },
    expectedUnit: 'PHH',
    expectedField: 'unit',
  },
  {
    name: 'Violation description with # pattern',
    record: { description: 'Violation in #4J bathroom' },
    expectedUnit: '4J',
    expectedField: 'description',
  },
  {
    name: 'Problem description pattern',
    record: { problem_description: 'Tenant in APT 3H reports leak' },
    expectedUnit: '3H',
    expectedField: 'problem_description',
  },
  {
    name: 'Penthouse in text',
    record: { novdescription: 'Work without permit in PH observed' },
    expectedUnit: 'PH',
    expectedField: 'novdescription',
  },
  {
    name: 'Direct apt_no field',
    record: { apt_no: '5K' },
    expectedUnit: '5K',
    expectedField: 'apt_no',
  },
];

// ============================================================================
// TEST RUNNER
// ============================================================================

export interface TestResults {
  passed: number;
  failed: number;
  errors: string[];
  duration: number;
}

/**
 * Run all unit extraction tests and log results.
 * Returns true if all tests pass, false otherwise.
 */
export function runUnitExtractionTests(): TestResults {
  const errors: string[] = [];
  let passed = 0;
  let failed = 0;
  const startTime = performance.now();
  
  console.log('[UnitTests] Running unit extraction regression tests...\n');
  
  // Test valid patterns
  console.log('=== Valid Unit Patterns ===');
  for (const { input, expected } of VALID_UNIT_PATTERNS) {
    const result = normalizeUnit(input);
    if (result === expected) {
      passed++;
      console.log(`✓ "${input}" → "${result}"`);
    } else {
      failed++;
      const error = `✗ "${input}": expected "${expected}", got "${result}"`;
      errors.push(error);
      console.error(error);
    }
  }
  
  // Test invalid patterns
  console.log('\n=== Invalid Unit Patterns (should return null) ===');
  for (const { input, reason } of INVALID_UNIT_PATTERNS) {
    const result = normalizeUnit(input);
    if (result === null) {
      passed++;
      console.log(`✓ "${input}" → null (${reason})`);
    } else {
      failed++;
      const error = `✗ "${input}": expected null (${reason}), got "${result}"`;
      errors.push(error);
      console.error(error);
    }
  }
  
  // Test isLikelyUnitLabel directly
  console.log('\n=== isLikelyUnitLabel Direct Tests ===');
  const labelTests = [
    // Core valid units (no strong evidence required) - CRITICAL REGRESSION TESTS
    { unit: '6M', expected: true, desc: 'digit+letter' },
    { unit: '6G', expected: true, desc: 'digit+letter' },
    { unit: '4J', expected: true, desc: 'digit+letter' },
    { unit: '2H', expected: true, desc: 'digit+letter' },
    { unit: '5K', expected: true, desc: 'digit+letter' },
    { unit: '12B', expected: true, desc: 'double-digit+letter' },
    { unit: '100A', expected: true, desc: 'triple-digit+letter' },
    { unit: '12AA', expected: true, desc: 'digit+double-letter' },
    { unit: '1', expected: true, desc: 'single digit' },
    { unit: '12', expected: true, desc: 'double digit' },
    { unit: '100', expected: true, desc: 'triple digit' },
    // Penthouse/special
    { unit: 'PH', expected: true, desc: 'penthouse' },
    { unit: 'PHH', expected: true, desc: 'penthouse high' },
    { unit: 'TH', expected: true, desc: 'townhouse' },
    { unit: 'GF', expected: true, desc: 'ground floor' },
    // Letter+digits
    { unit: 'A1', expected: true, desc: 'letter+digit' },
    { unit: 'A12', expected: true, desc: 'letter+digits' },
    // FALSE POSITIVES - MUST REJECT
    { unit: 'ONLY', expected: false, desc: 'stopword' },
    { unit: 'IF', expected: false, desc: 'stopword' },
    { unit: 'AH', expected: false, desc: 'stopword' },
    { unit: 'S', expected: false, desc: 'single letter without evidence' },
    { unit: 'BROOKLYN', expected: false, desc: 'borough name' },
    { unit: '1200', expected: false, desc: '4+ digit number' },
    { unit: 'B00123456', expected: false, desc: 'job number' },
    { unit: '11201', expected: false, desc: 'ZIP code' },
  ];
  
  for (const { unit, expected, desc } of labelTests) {
    const result = isLikelyUnitLabel(unit);
    if (result === expected) {
      passed++;
      console.log(`✓ isLikelyUnitLabel("${unit}") = ${result} (${desc})`);
    } else {
      failed++;
      const error = `✗ isLikelyUnitLabel("${unit}"): expected ${expected}, got ${result} (${desc})`;
      errors.push(error);
      console.error(error);
    }
  }
  
  // Test record extraction
  console.log('\n=== Record Extraction Tests ===');
  for (const { name, record, expectedUnit, expectedField } of RECORD_EXTRACTION_FIXTURES) {
    const result = extractUnitFromRecordWithTrace(record);
    if (result && result.normalizedUnit === expectedUnit) {
      passed++;
      console.log(`✓ ${name}: "${expectedUnit}" from "${result.sourceField}"`);
    } else if (result) {
      failed++;
      const error = `✗ ${name}: expected "${expectedUnit}" from "${expectedField}", got "${result.normalizedUnit}" from "${result.sourceField}"`;
      errors.push(error);
      console.error(error);
    } else {
      failed++;
      const error = `✗ ${name}: expected "${expectedUnit}", got null`;
      errors.push(error);
      console.error(error);
    }
  }
  
  const duration = performance.now() - startTime;
  
  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Duration: ${duration.toFixed(1)}ms`);
  
  if (failed > 0) {
    console.error('\nFailed tests:');
    errors.forEach(e => console.error(`  ${e}`));
  } else {
    console.log('\n✅ All tests passed!');
  }
  
  return { passed, failed, errors, duration };
}

// Export for use in dev console: window.runUnitExtractionTests = runUnitExtractionTests
if (typeof window !== 'undefined') {
  (window as any).runUnitExtractionTests = runUnitExtractionTests;
}
