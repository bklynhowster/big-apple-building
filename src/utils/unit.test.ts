import { isLikelyUnitLabel, normalizeUnit, extractUnitFromRecordWithTrace } from './unit';

// Simple test helpers (vitest not installed)
const describe = (name: string, fn: () => void) => { console.log(`\n=== ${name} ===`); fn(); };
const it = (name: string, fn: () => void) => { try { fn(); console.log(`✓ ${name}`); } catch (e) { console.error(`✗ ${name}:`, e); } };
const expect = (val: unknown) => ({
  toBe: (expected: unknown) => { if (val !== expected) throw new Error(`Expected ${expected}, got ${val}`); },
  toBeNull: () => { if (val !== null) throw new Error(`Expected null, got ${val}`); },
});

describe('unit validation: isLikelyUnitLabel', () => {
  it('allows digit+letter units without strong evidence', () => {
    expect(isLikelyUnitLabel('6G', false)).toBe(true);
    expect(isLikelyUnitLabel('4J', false)).toBe(true);
    expect(isLikelyUnitLabel('6M', false)).toBe(true);
    expect(isLikelyUnitLabel('12B', false)).toBe(true);
    expect(isLikelyUnitLabel('100A', false)).toBe(true);
    expect(isLikelyUnitLabel('12AA', false)).toBe(true);
  });

  it('rejects numeric-only units without strong evidence, allows with strong evidence', () => {
    expect(isLikelyUnitLabel('12', false)).toBe(false);
    expect(isLikelyUnitLabel('100', false)).toBe(false);
    expect(isLikelyUnitLabel('12', true)).toBe(true);
    expect(isLikelyUnitLabel('100', true)).toBe(true);
  });

  it('rejects ordinals that look like digit+letter', () => {
    expect(isLikelyUnitLabel('6TH', true)).toBe(false);
    expect(isLikelyUnitLabel('12TH', true)).toBe(false);
    expect(isLikelyUnitLabel('1ST', true)).toBe(false);
    expect(isLikelyUnitLabel('2ND', true)).toBe(false);
    expect(isLikelyUnitLabel('3RD', true)).toBe(false);
  });

  it('allows special tokens only when known', () => {
    expect(isLikelyUnitLabel('PH', false)).toBe(true);
    expect(isLikelyUnitLabel('PHH', false)).toBe(true);
    expect(isLikelyUnitLabel('TH', false)).toBe(true);
    expect(isLikelyUnitLabel('GF', false)).toBe(true);
    expect(isLikelyUnitLabel('BS', false)).toBe(true);
    expect(isLikelyUnitLabel('ONLY', true)).toBe(false);
    expect(isLikelyUnitLabel('IF', true)).toBe(false);
    expect(isLikelyUnitLabel('AH', true)).toBe(false);
  });
});

describe('unit normalization: normalizeUnit', () => {
  it('does not apply stoplist to digit tokens', () => {
    expect(normalizeUnit('6M', false, false)).toBe('6M');
    expect(normalizeUnit('12B', false, false)).toBe('12B');
  });

  it('numeric-only requires evidence', () => {
    expect(normalizeUnit('12', false, false)).toBeNull();
    expect(normalizeUnit('12', false, true)).toBe('12');
  });

  it('strips prefixes and cleans separators', () => {
    expect(normalizeUnit('APT 6G', false, true)).toBe('6G');
    expect(normalizeUnit('# 12B', false, true)).toBe('12B');
    expect(normalizeUnit('UNIT-100A', false, true)).toBe('100A');
    expect(normalizeUnit('12-B', false, false)).toBe('12B');
    expect(normalizeUnit('12 B', false, false)).toBe('12B');
  });
});

describe('record extraction: extractUnitFromRecordWithTrace', () => {
  it('extracts from direct apartment field with strong evidence', () => {
    const rec = { apartment: '12' };
    const r = extractUnitFromRecordWithTrace(rec);
    expect(r?.normalizedUnit).toBe('12');
    expect(r?.confidence).toBe('high');
  });

  it('extracts from explicit APT prefix in text', () => {
    const rec = { descriptor: 'Leak in APT 12' };
    const r = extractUnitFromRecordWithTrace(rec);
    expect(r?.normalizedUnit).toBe('12');
  });

  it('does NOT infer units from ordinal/floor narrative', () => {
    const rec = { descriptor: 'PUBLIC HALL, 6th STORY - noise complaint' };
    const r = extractUnitFromRecordWithTrace(rec);
    expect(r).toBeNull();
  });

  it('does not infer bare numeric from free text (no prefix)', () => {
    const rec = { descriptor: 'Complaint on 12 for noise' };
    const r = extractUnitFromRecordWithTrace(rec);
    // no explicit APT/UNIT/#, so should not treat bare "12" as unit
    expect(r).toBeNull();
  });
});

// Optional: expose a simple test runner for manual console use
if (typeof window !== 'undefined') {
  (window as any).runUnitExtractionTests = () => {
    // Vitest runs these normally; this helper is only for quick manual checks.
    // eslint-disable-next-line no-console
    console.log('Run `pnpm test` / `npm test` to execute vitest suite.');
  };
}
