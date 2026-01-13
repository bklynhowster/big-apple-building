/* eslint-disable no-console */
/**
 * Unit normalization + extraction utilities
 * STABLE VERSION — Lovable-safe
 */

export type UnitType = "APT" | "UNIT" | "PH" | "UNKNOWN";
export type UnitConfidence = "high" | "medium" | "low";

export interface UnitExtractionResult {
  normalizedUnit: string;
  asReported: string;
  sourceField: string;
  snippet: string | null;
  unitType: UnitType;
  confidence: UnitConfidence;
  confidenceReason: string;
}

// ============================================================
// DEBUG (Lovable-safe)
// ============================================================

const DEBUG = typeof window !== "undefined" && window.location.search.includes("debug=1");

function debugLog(event: string, payload: unknown) {
  if (!DEBUG) return;
  console.log(`[UnitDebug:${event}]`, payload);
}

// ============================================================
// CONSTANTS
// ============================================================

const JUNK = new Set([
  "",
  "N/A",
  "NA",
  "NONE",
  "UNKNOWN",
  "0",
  "-",
  "NULL",
  "BUILDING",
  "BLDG",
  "BASEMENT",
  "CELLAR",
  "ROOF",
  "COMMON",
  "LOBBY",
  "HALLWAY",
  "ALL",
  "ENTIRE",
]);

const ADDRESS_WORDS = [
  "STREET",
  "ST",
  "AVENUE",
  "AVE",
  "ROAD",
  "RD",
  "BOULEVARD",
  "BLVD",
  "PLACE",
  "PL",
  "DRIVE",
  "DR",
  "LANE",
  "LN",
  "WAY",
  "TERRACE",
  "COURT",
  "CT",
  "BROOKLYN",
  "MANHATTAN",
  "QUEENS",
  "BRONX",
  "STATEN",
];

const PREFIXES = ["APT", "APARTMENT", "UNIT", "RM", "ROOM", "STE", "SUITE", "#", "PH", "PENTHOUSE"];

const STRIP_PREFIX_RE = new RegExp(`^(${PREFIXES.join("|")})\\s*[#:\\-\\.\\s]*`, "i");

// ============================================================
// VALIDATION
// ============================================================

export function isLikelyUnitLabel(value: string, strong = false): boolean {
  const v = value.toUpperCase();

  if (!v || v.length > 8) return false;
  if (JUNK.has(v)) return false;

  // Ordinals (6TH, 12TH, etc.)
  if (/^\d{1,3}(ST|ND|RD|TH)$/.test(v)) return false;

  // ZIP codes
  if (/^\d{5}$/.test(v)) return false;

  // Digit + letter(s) — ALWAYS allowed
  if (/^[1-9]\d{0,2}[A-Z]{1,2}$/.test(v)) return true;

  // Numeric-only requires strong evidence
  if (/^[1-9]\d{0,2}$/.test(v)) return strong;

  // PH / special
  if (/^PH[A-Z0-9]{0,2}$/.test(v)) return true;

  return false;
}

// ============================================================
// NORMALIZATION
// ============================================================

export function normalizeUnit(raw: string | null | undefined, _relaxed = false, strong = false): string | null {
  if (!raw) return null;

  let v = String(raw).trim().toUpperCase();
  if (!v) return null;

  if (JUNK.has(v)) return null;

  // Address-word guard
  for (const w of ADDRESS_WORDS) {
    if (new RegExp(`\\b${w}\\b`).test(v)) return null;
  }

  // Strip prefixes
  v = v.replace(STRIP_PREFIX_RE, "");

  // Remove punctuation
  v = v.replace(/[^A-Z0-9]/g, "");

  if (!v) return null;
  if (!isLikelyUnitLabel(v, strong)) return null;

  return v;
}

// ============================================================
// EXTRACTION (explicit prefixes only)
// ============================================================

const EXPLICIT_PATTERNS: Array<{
  re: RegExp;
  type: UnitType;
}> = [
  { re: /\bAPT\.?\s*#?\s*([A-Z0-9]{1,6})\b/i, type: "APT" },
  { re: /\bAPARTMENT\s*#?\s*([A-Z0-9]{1,6})\b/i, type: "APT" },
  { re: /\bUNIT\s*#?\s*([A-Z0-9]{1,6})\b/i, type: "UNIT" },
  { re: /\bRM\.?\s*#?\s*([A-Z0-9]{1,6})\b/i, type: "APT" },
  { re: /\bROOM\s*#?\s*([A-Z0-9]{1,6})\b/i, type: "APT" },
  { re: /\bSTE\.?\s*#?\s*([A-Z0-9]{1,6})\b/i, type: "UNIT" },
  { re: /\bSUITE\s*#?\s*([A-Z0-9]{1,6})\b/i, type: "UNIT" },
  { re: /#\s*([A-Z0-9]{1,6})\b/i, type: "APT" },
  { re: /\bPH\s*([A-Z0-9]{0,2})\b/i, type: "PH" },
  { re: /\bPENTHOUSE\s*([A-Z0-9]{0,2})\b/i, type: "PH" },
];

export function extractUnitFromRecordWithTrace(
  record: Record<string, unknown> | null | undefined,
): UnitExtractionResult | null {
  if (!record) return null;

  for (const [field, value] of Object.entries(record)) {
    if (typeof value !== "string") continue;

    for (const { re, type } of EXPLICIT_PATTERNS) {
      const m = value.match(re);
      if (!m) continue;

      const rawToken = m[1] ?? "";
      const normalized = normalizeUnit(rawToken, false, true);
      if (!normalized) continue;

      debugLog("accept", { field, rawToken, normalized });

      return {
        normalizedUnit: normalized,
        asReported: m[0],
        sourceField: field,
        snippet: value.slice(0, 200),
        unitType: type,
        confidence: "high",
        confidenceReason: "Explicit apartment/unit reference",
      };
    }
  }

  return null;
}

export function extractUnitFromRecord(record: Record<string, unknown> | null | undefined): string | null {
  return extractUnitFromRecordWithTrace(record)?.normalizedUnit ?? null;
}

// ============================================================
// DIAGNOSTICS: candidate extraction (NO validation)
// ============================================================

const CANDIDATE_RE = /\b([1-9]\d{0,2}[A-Z]{0,2})\b/g;

export function extractUnitCandidatesFromText(text: string): Array<{ token: string; strong: boolean }> {
  const out: Array<{ token: string; strong: boolean }> = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = CANDIDATE_RE.exec(text)) !== null) {
    const token = m[1].toUpperCase();
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({ token, strong: false });
  }

  return out;
}

// ============================================================
// GROUPING / STATS
// ============================================================

export function groupRecordsByUnit<T extends Record<string, unknown>>(records: T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const r of records) {
    const u = extractUnitFromRecord(r);
    const arr = map.get(u) ?? [];
    arr.push(r);
    map.set(u, arr);
  }
  return map;
}

export function filterRecordsByUnit<T extends Record<string, unknown>>(records: T[], unitContext: string | null): T[] {
  if (!unitContext) return records;
  const norm = normalizeUnit(unitContext, false, true);
  if (!norm) return records;
  return records.filter((r) => extractUnitFromRecord(r) === norm);
}

export function recordMentionsUnit(
  record: Record<string, unknown> | null | undefined,
  unitContext: string | null,
): boolean {
  if (!record || !unitContext) return false;
  const norm = normalizeUnit(unitContext, false, true);
  if (!norm) return false;
  return extractUnitFromRecord(record) === norm;
}

// ============================================================
// DEBUG GLOBALS (Lovable-safe)
// ============================================================

declare global {
  interface Window {
    runUnitSanityChecks?: () => void;
    __unitDebug?: unknown;
  }
}

if (typeof window !== "undefined" && DEBUG) {
  window.runUnitSanityChecks = () => {
    console.log("[UnitSanity]", {
      "6G": isLikelyUnitLabel("6G", false),
      "12": isLikelyUnitLabel("12", false),
      "12 strong": isLikelyUnitLabel("12", true),
      "6TH": isLikelyUnitLabel("6TH", true),
    });
  };

  window.__unitDebug = {
    normalizeUnit,
    extractUnitFromRecordWithTrace,
    extractUnitCandidatesFromText,
  };
}
