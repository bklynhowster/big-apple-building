/* eslint-disable no-console */

/**
 * Unit normalization + extraction utilities
 * STABLE + BACKWARD-COMPATIBLE (Lovable-safe)
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

const DEBUG = typeof window !== "undefined" && window.location.search.includes("debug=1");

function debugLog(event: string, payload: unknown) {
  if (!DEBUG) return;
  console.log(`[UnitDebug:${event}]`, payload);
}

// ============================================================
// STOPWORDS (BACKWARD COMPATIBILITY FIX)
// ============================================================

const STOPWORDS = new Set([
  "",
  "N/A",
  "NA",
  "NONE",
  "UNKNOWN",
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

/**
 * REQUIRED by existing imports elsewhere in the app
 */
export function isStopword(value: string | null | undefined): boolean {
  if (!value) return true;
  return STOPWORDS.has(value.toUpperCase().trim());
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
  if (isStopword(v)) return false;

  // Ordinals (6TH, 12TH)
  if (/^\d{1,3}(ST|ND|RD|TH)$/.test(v)) return false;

  // ZIP codes
  if (/^\d{5}$/.test(v)) return false;

  // Digit + letter(s)
  if (/^[1-9]\d{0,2}[A-Z]{1,2}$/.test(v)) return true;

  // Numeric-only requires strong signal
  if (/^[1-9]\d{0,2}$/.test(v)) return strong;

  // PH
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

  if (isStopword(v)) return null;

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
// EXTRACTION — EXPLICIT REFERENCES ONLY
// ============================================================

const EXPLICIT_PATTERNS: Array<{ re: RegExp; type: UnitType }> = [
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
// DIAGNOSTIC TOKEN SCAN (NON-BINDING)
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
// DEBUG GLOBALS
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
      "12": isLikelyUnitLabel("12"),
      "12 strong": isLikelyUnitLabel("12", true),
      "6TH": isLikelyUnitLabel("6TH", true),
    });
  };
}
