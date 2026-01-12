/**
 * Unit extraction regression tests.
 * Run these to verify that common unit patterns are correctly extracted.
 * 
 * These tests validate the unit extraction logic used for "Mentioned Units"
 * in co-op buildings to ensure common apartment patterns are recognized.
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
  // Number + letter patterns (most common)
  { input: '6M', expected: '6M' },
  { input: '2G', expected: '2G' },
  { input: '12B', expected: '12B' },
  { input: '1A', expected: '1A' },
  { input: '10F', expected: '10F' },
  
  // Letter + number patterns
  { input: 'A1', expected: 'A1' },
  { input: 'B12', expected: 'B12' },
  
  // With prefixes (should be stripped)
  { input: 'APT 2G', expected: '2G' },
  { input: 'UNIT PH', expected: 'PH' },
  { input: '#12B', expected: '12B' },
  { input: 'Apartment 6M', expected: '6M' },
  { input: 'APT. 3A', expected: '3A' },
  
  // Penthouse patterns
  { input: 'PH', expected: 'PH' },
  { input: 'PHA', expected: 'PHA' },
  { input: 'PH1', expected: 'PH1' },
  // Note: 'PENTHOUSE' alone doesn't normalize to PH in normalizeUnit,
  // but the text extraction patterns handle it specially
  
  // Short numeric (1-2 digits)
  { input: '1', expected: '1' },
  { input: '12', expected: '12' },
  
  // Single letters
  { input: 'A', expected: 'A' },
  { input: 'G', expected: 'G' },
  
  // With separators (should be normalized)
  { input: '12-B', expected: '12B' },
  { input: '6 M', expected: '6M' },
  { input: '2.G', expected: '2G' },
];

const INVALID_UNIT_PATTERNS = [
  // Address-like values
  { input: '325 STREET', reason: 'address' },
  { input: '40 TEHAMA STREET', reason: 'address' },
  { input: 'BROOKLYN', reason: 'borough' },
  
  // Job numbers
  { input: 'B00123456', reason: 'job number' },
  { input: 'NB12345', reason: 'new building number' },
  
  // Floor-only
  { input: 'FLOOR 3', reason: 'floor only' },
  { input: '3RD FLOOR', reason: 'floor only' },
  { input: 'FL2', reason: 'floor only' },
  
  // Junk values
  { input: 'N/A', reason: 'junk' },
  { input: 'NONE', reason: 'junk' },
  { input: 'BUILDING', reason: 'junk' },
  { input: 'BASEMENT', reason: 'junk' },
  
  // Long numbers (house numbers)
  { input: '325', reason: 'house number' },
  { input: '1200', reason: 'house number' },
  
  // ZIP codes
  { input: '11201', reason: 'zip code' },
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
    record: { apartment: '2G' },
    expectedUnit: '2G',
    expectedField: 'apartment',
  },
  {
    name: 'HPD complaint with unit in descriptor',
    record: { descriptor: 'HEAT/HOT WATER - APT 12B - NO HEAT' },
    expectedUnit: '12B',
    expectedField: 'descriptor',
  },
  {
    name: 'Unit field with prefix',
    record: { unit: 'UNIT PH' },
    expectedUnit: 'PH',
    expectedField: 'unit',
  },
  {
    name: 'Violation description with # pattern',
    record: { description: 'Violation in #4J bathroom' },
    expectedUnit: '4J',
    expectedField: 'description',
  },
];

// ============================================================================
// TEST RUNNER
// ============================================================================

/**
 * Run all unit extraction tests and log results.
 * Returns true if all tests pass, false otherwise.
 */
export function runUnitExtractionTests(): { passed: number; failed: number; errors: string[] } {
  const errors: string[] = [];
  let passed = 0;
  let failed = 0;
  
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
    { unit: '6M', expected: true },
    { unit: '2G', expected: true },
    { unit: '12B', expected: true },
    { unit: 'PH', expected: true },
    { unit: 'PHA', expected: true },
    { unit: 'A1', expected: true },
    { unit: '1', expected: true },
    { unit: 'A', expected: true },
    { unit: '325', expected: false }, // 3+ digit number
    { unit: 'B00123456', expected: false }, // Job number
  ];
  
  for (const { unit, expected } of labelTests) {
    const result = isLikelyUnitLabel(unit);
    if (result === expected) {
      passed++;
      console.log(`✓ isLikelyUnitLabel("${unit}") = ${result}`);
    } else {
      failed++;
      const error = `✗ isLikelyUnitLabel("${unit}"): expected ${expected}, got ${result}`;
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
  
  // Summary
  console.log(`\n=== Summary ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  
  if (failed > 0) {
    console.error('\nFailed tests:');
    errors.forEach(e => console.error(`  ${e}`));
  }
  
  return { passed, failed, errors };
}

// Export for use in dev console: window.runUnitExtractionTests = runUnitExtractionTests
if (typeof window !== 'undefined') {
  (window as any).runUnitExtractionTests = runUnitExtractionTests;
}
