/* eslint-disable no-console */

/**
 * Unit normalization + extraction utilities (Lovable-safe)
 *
 * Goals:
 * 1) Keep a stable exported API so the UI doesn't break.
 * 2) Be conservative: only infer units from explicit apartment/unit prefixes in records.
 * 3) Provide diagnostics helpers without changing core extraction behavior.
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
// DEBUG
// ============================================================

const DEBUG = typeof window !== "undefined" && !!window.location?.search && window.location.search.includes("debug=1");

function debugLog(event: string, payload: unknown) {
  if (!DEBUG) return;
  try {
    console.log(`[UnitDebug:${event}]`, payload);
  } catch {
    // ignore
  }
}

// ============================================================
// STOPWORDS / JUNK
// ============================================================

const STOPWORDS = new Set([
  "",
  "N/A",
  "NA",
  "NONE",
  "UNKNOWN",
  "NULL",
  "0",
  "-",
  "BUILDING",
  "BLDG",
  "BASEMENT",
  "BSMT",
  "CELLAR",
  "ROOF",
  "COMMON",
  "LOBBY",
  "HALLWAY",
  "ALL",
  "ENTIRE",
]);

/**
 * REQUIRED EXPORT (some components import this)
 */
export function isStopword(value: string | null | undefined): boolean {
  if (value == null) return true;
  return STOPWORDS.has(String(value).toUpperCase().trim());
}

// ============================================================
// CONSTANTS
// ============================================================

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
  "TER",
  "COURT",
  "CT",
  "CIR",
  "BROOKLYN",
  "MANHATTAN",
  "QUEENS",
  "BRONX",
  "STATEN",
  "EAST",
  "WEST",
  "NORTH",
  "SOUTH",
];

const PREFIXES = ["APARTMENT", "APT\\.?", "UNIT", "SUITE", "STE\\.?", "ROOM", "RM\\.?", "#", "NO\\.?", "NUMBER"];

const STRIP_PREFIX_RE = new RegExp(`^(${PREFIXES.join("|")})\\s*[#:\\-\\.\\s]*`, "i");

function containsAddressWord(s: string): boolean {
  const upper = s.toUpperCase();
  return ADDRESS_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(upper));
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Conservative validator:
 * - digit+letter (6G, 12B, 12AA) => allowed
 * - numeric-only (12) => only allowed with strong evidence
 * - ordinals (6TH) => never
 * - 5-digit ZIP => never
 * - PH, PH1 => allowed
 */
export function isLikelyUnitLabel(value: string, strong = false): boolean {
  const v = String(value ?? "")
    .toUpperCase()
    .trim();
  if (!v || v.length > 8) return false;
  if (isStopword(v)) return false;

  // ordinals
  if (/^\d{1,3}(ST|ND|RD|TH)$/.test(v)) return false;

  // zip
  if (/^\d{5}$/.test(v)) return false;

  // digit + 1-2 letters (always)
  if (/^[1-9]\d{0,2}[A-Z]{1,2}$/.test(v)) return true;

  // numeric-only requires strong evidence
  if (/^[1-9]\d{0,2}$/.test(v)) return strong;

  // PH forms
  if (/^PH[A-Z0-9]{0,2}$/.test(v)) return true;

  // letter+digits (rare but present)
  if (/^[A-Z]\d{1,3}$/.test(v)) return true;

  return false;
}

// ============================================================
// NORMALIZATION
// ============================================================

export function normalizeUnit(raw: string | null | undefined, _relaxed = false, strong = false): string | null {
  if (raw == null) return null;

  let v = String(raw).trim().toUpperCase();
  if (!v) return null;

  if (isStopword(v)) return null;

  // reject obvious address-like strings
  if (containsAddressWord(v)) return null;

  // strip common prefixes at the beginning
  v = v.replace(STRIP_PREFIX_RE, "");

  // remove punctuation/separators
  v = v.replace(/[\s\-\.]+/g, "");
  v = v.replace(/[^A-Z0-9]/g, "");

  if (!v) return null;
  if (isStopword(v)) return null;

  if (!isLikelyUnitLabel(v, strong)) return null;

  return v;
}

// ============================================================
// EXTRACTION — EXPLICIT REFERENCES ONLY (SAFE)
// ============================================================

const EXPLICIT_PATTERNS: Array<{ re: RegExp; unitType: UnitType; reason: string }> = [
  { re: /\bAPT\.?\s*#?\s*([A-Z0-9]{1,8})\b/i, unitType: "APT", reason: "Explicit APT prefix" },
  { re: /\bAPARTMENT\s*#?\s*([A-Z0-9]{1,8})\b/i, unitType: "APT", reason: "Explicit APARTMENT prefix" },
  { re: /\bUNIT\s*#?\s*([A-Z0-9]{1,8})\b/i, unitType: "UNIT", reason: "Explicit UNIT prefix" },
  { re: /\bRM\.?\s*#?\s*([A-Z0-9]{1,8})\b/i, unitType: "APT", reason: "Explicit RM prefix" },
  { re: /\bROOM\s*#?\s*([A-Z0-9]{1,8})\b/i, unitType: "APT", reason: "Explicit ROOM prefix" },
  { re: /\bSTE\.?\s*#?\s*([A-Z0-9]{1,8})\b/i, unitType: "UNIT", reason: "Explicit STE prefix" },
  { re: /\bSUITE\s*#?\s*([A-Z0-9]{1,8})\b/i, unitType: "UNIT", reason: "Explicit SUITE prefix" },
  { re: /#\s*([A-Z0-9]{1,8})\b/i, unitType: "APT", reason: "Explicit # prefix" },
  { re: /\bPH\s*([A-Z0-9]{0,3})\b/i, unitType: "PH", reason: "Explicit PH prefix" },
  { re: /\bPENTHOUSE\s*([A-Z0-9]{0,3})\b/i, unitType: "PH", reason: "Explicit PENTHOUSE prefix" },
];

function makeSnippet(s: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(s.length, index + length + 40);
  return (start > 0 ? "…" : "") + s.slice(start, end).trim() + (end < s.length ? "…" : "");
}

export function extractUnitFromRecordWithTrace(
  record: Record<string, unknown> | null | undefined,
): UnitExtractionResult | null {
  if (!record) return null;

  for (const [field, value] of Object.entries(record)) {
    if (typeof value !== "string") continue;
    const text = value;

    for (const { re, unitType, reason } of EXPLICIT_PATTERNS) {
      const m = text.match(re);
      if (!m) continue;

      let token = (m[1] ?? "").toUpperCase().trim();

      // PH normalization: PH + suffix if present
      if (unitType === "PH") {
        const suffix = token.replace(/^PH/i, "");
        token = `PH${suffix}`.toUpperCase();
      }

      const normalized = normalizeUnit(token, false, true);
      if (!normalized) continue;

      const idx = m.index ?? 0;

      debugLog("extract.accept", { field, token, normalized, match: m[0] });

      return {
        normalizedUnit: normalized,
        asReported: m[0],
        sourceField: field,
        snippet: makeSnippet(text, idx, m[0].length),
        unitType,
        confidence: "high",
        confidenceReason: reason,
      };
    }
  }

  return null;
}

export function extractUnitFromRecord(record: Record<string, unknown> | null | undefined): string | null {
  return extractUnitFromRecordWithTrace(record)?.normalizedUnit ?? null;
}

// ============================================================
// DIAGNOSTICS (non-binding candidates)
// ============================================================

/**
 * Used by UnitExtractionDiagnostics UI to list "unit-like" tokens,
 * but does NOT mean they are accepted.
 */
export function extractUnitCandidatesFromText(text: string): Array<{ token: string; strong: boolean }> {
  const out: Array<{ token: string; strong: boolean }> = [];
  const seen = new Set<string>();

  // simple "unit-looking" token scanner: 1-3 digits + optional 0-2 letters
  const re = /\b([1-9]\d{0,2}[A-Z]{0,2})\b/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const token = (m[1] ?? "").toUpperCase();
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({ token, strong: false });
  }

  return out;
}

// ============================================================
// STATS HELPERS (REQUIRED BY UnitInsightsCard.tsx)
// ============================================================

export function groupRecordsByUnit<T extends Record<string, unknown>>(records: T[]): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const r of records) {
    const unit = extractUnitFromRecord(r);
    const arr = groups.get(unit) ?? [];
    arr.push(r);
    groups.set(unit, arr);
  }
  return groups;
}

export interface UnitStats {
  unit: string;
  count: number;
  lastActivity: Date | null;
}

export function getUnitStats<T extends Record<string, unknown>>(
  records: T[],
  dateField: string = "issueDate",
): UnitStats[] {
  const groups = groupRecordsByUnit(records);
  const stats: UnitStats[] = [];

  for (const [unit, recs] of groups.entries()) {
    if (!unit) continue;

    let maxDate: Date | null = null;
    for (const r of recs) {
      const v = r[dateField] as unknown;
      if (typeof v === "string" && v) {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) {
          if (!maxDate || d > maxDate) maxDate = d;
        }
      }
    }

    stats.push({ unit, count: recs.length, lastActivity: maxDate });
  }

  return stats.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.unit.localeCompare(b.unit, undefined, { numeric: true });
  });
}

export function filterRecordsByUnit<T extends Record<string, unknown>>(records: T[], unitContext: string | null): T[] {
  if (!unitContext) return records;

  // treat user context as strong so numeric-only filters still work in the UI
  const normalized = normalizeUnit(unitContext, false, true);
  if (!normalized) return records;

  return records.filter((r) => extractUnitFromRecord(r) === normalized);
}

export function recordMentionsUnit(
  record: Record<string, unknown> | null | undefined,
  unitContext: string | null,
): boolean {
  if (!record || !unitContext) return false;

  const normalized = normalizeUnit(unitContext, false, true);
  if (!normalized) return false;

  return extractUnitFromRecord(record) === normalized;
}

// ============================================================
// DEV GLOBALS
// ============================================================

declare global {
  interface Window {
    runUnitSanityChecks?: () => void;
  }
}

if (typeof window !== "undefined" && DEBUG) {
  window.runUnitSanityChecks = () => {
    console.log("[UnitSanity]", {
      "6G": isLikelyUnitLabel("6G"),
      "12 weak": isLikelyUnitLabel("12"),
      "12 strong": isLikelyUnitLabel("12", true),
      "6TH": isLikelyUnitLabel("6TH", true),
      PH: isLikelyUnitLabel("PH", true),
      PH1: isLikelyUnitLabel("PH1", true),
    });
  };
}
