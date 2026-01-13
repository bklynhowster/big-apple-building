/* eslint-disable no-console */
/**
 * Unit normalization utilities for co-op buildings.
 *
 * Key rules:
 * - Digit+letter units: ALWAYS allowed (e.g., 6G, 4J, 12B, 100A, 12AA) regardless of strong evidence.
 * - Numeric-only tokens: ONLY allowed WITH strong evidence (explicit apt/unit fields or explicit prefixes).
 * - Ordinals (1ST/2ND/3RD/4TH/12TH/etc.) are NEVER units.
 * - STOPLIST applies ONLY to alpha-only tokens (no digits).
 * - Do not add extraction-layer hard blocks. Validation lives in normalizeUnit/isLikelyUnitLabel only.
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

// ------------------------------
// Debug helpers (safe ordering)
// ------------------------------

const EXTRACTION_DEBUG =
  typeof window !== "undefined" && window.location?.search?.includes("debug=1") && (import.meta as any)?.env?.DEV;

function debugLog(event: string, payload: Record<string, unknown>) {
  if (!EXTRACTION_DEBUG) return;
  // keep logs small to avoid spam
  const safe = JSON.parse(
    JSON.stringify(payload, (_, v) => (typeof v === "string" && v.length > 180 ? v.slice(0, 180) + "…" : v)),
  );
  console.log(`[${event}]`, safe);
}

// ------------------------------
// Constants
// ------------------------------

const JUNK_VALUES = new Set([
  "",
  "N/A",
  "NA",
  "NONE",
  "UNKNOWN",
  "0",
  "-",
  "N",
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
  "BSMT",
  "ROOFDECK",
  "TERRACE",
  "GARAGE",
  "STORE",
  "STOREFRONT",
  "COMMERCIAL",
]);

/**
 * STOPLIST: applied ONLY to alpha-only tokens (no digits).
 * IMPORTANT: Do NOT include single letters A–Z here; those are handled separately.
 */
const UNIT_STOPLIST = new Set([
  "ONLY",
  "IF",
  "AND",
  "OR",
  "BUT",
  "NOT",
  "YES",
  "NO",
  "THE",
  "AN",
  "IN",
  "ON",
  "AT",
  "BY",
  "TO",
  "FOR",
  "OF",
  "FROM",
  "WITH",
  "WITHOUT",
  "AS",
  "IS",
  "IT",
  "BE",
  "SO",
  "WE",
  "ME",
  "HE",
  "OK",
  "AM",
  "PM",
  "HAS",
  "HAD",
  "WAS",
  "ARE",
  "CAN",
  "DID",
  "DO",
  "HER",
  "HIM",
  "HIS",
  "ITS",
  "MY",
  "OUR",
  "THAT",
  "THEM",
  "THEY",
  "THIS",
  "WHO",
  "WILL",
  "BEEN",
  "HAVE",
  "WERE",
  "WHAT",
  "WHEN",
  "WHERE",
  "WHICH",
  "YOUR",
  "NYC",
  "BK",
  "MN",
  "BX",
  "QN",
  "SI",
  "NY",
  "NJ",
  "APT",
  "UNIT",
  "FL",
  "FLOOR",
  "RM",
  "ROOM",
  "STE",
  "SUITE",
  "ST",
  "AVE",
  "AV",
  "RD",
  "BLVD",
  "PL",
  "DR",
  "CT",
  "LN",
  "WAY",
  "TER",
  "CIR",
  "UNK",
  "TBD",
  "NA",
  "NEED",
  "NEW",
  "OLD",
  "SEE",
  "PER",
  "USE",
  "AH",
  "OH",
  "UH",
  "RE",
  "CC",
  "CO",
  "VS",
  "IE",
  "EG",
  "OPEN",
  "CLOSED",
  "PENDING",
  "DONE",
  "FAIL",
  "PASS",
  "GOOD",
  "BAD",
  // ordinals as standalone words sometimes appear; keep them here (alpha-only)
  "ND",
  "RD",
  "TH",
]);

const PENTHOUSE_TOKENS = new Set(["PH", "PHH", "PHS", "PHN", "PHE", "PHW", "TH", "GF", "LH", "RH", "BS"]);

const STRIP_PREFIXES = [
  "APARTMENT",
  "APT\\.?", // APT / APT.
  "UNIT",
  "SUITE",
  "STE\\.?", // STE / STE.
  "ROOM",
  "RM\\.?", // RM / RM.
  "#",
  "NO\\.?", // NO / NO.
  "NUMBER",
];

const FLOOR_ONLY_PATTERNS: RegExp[] = [
  /^(?:FLOOR|FL)\s*\d+$/i,
  /^\d+(?:ST|ND|RD|TH)\s*(?:FLOOR|FL)$/i,
  /^(?:1ST|2ND|3RD|\d+TH)\s*FL(?:OOR)?$/i,
  /^FL\d+$/i,
];

const JOB_NUMBER_PATTERNS: RegExp[] = [/^[ABJMNPQRX]\d{8,}$/i, /^NB\d+$/i, /^A[123]\d+$/i, /^\d{8,}$/];

const ADDRESS_SUFFIXES = ["ST", "AVE", "AV", "RD", "BLVD", "PL", "DR", "CT", "LN", "WAY", "TER", "CIR"];
const ORDINAL_SUFFIXES = ["ST", "ND", "RD", "TH"];

const ADDRESS_SUBSTRINGS = [
  "STREET",
  "AVENUE",
  "ROAD",
  "BOULEVARD",
  "BLVD",
  "PLACE",
  "DRIVE",
  "LANE",
  "WEST",
  "EAST",
  "NORTH",
  "SOUTH",
  "BROOKLYN",
  "MANHATTAN",
  "BRONX",
  "QUEENS",
  "STATEN",
];

export function isStopword(token: string): boolean {
  return UNIT_STOPLIST.has(token.toUpperCase());
}

function containsAddressSubstring(raw: string): boolean {
  const upper = raw.toUpperCase();
  return ADDRESS_SUBSTRINGS.some((substr) => new RegExp(`\\b${substr}\\b`, "i").test(upper));
}

function isAllowedSpecialToken(token: string): boolean {
  return PENTHOUSE_TOKENS.has(token.toUpperCase());
}

/**
 * Single-letter units are highly ambiguous in free text.
 * Allow only WITH strong evidence and never allow "S" (too common).
 */
function isAllowedSingleLetterUnit(token: string, hasStrongEvidence: boolean): boolean {
  if (!hasStrongEvidence) return false;
  const upper = token.toUpperCase();
  if (upper === "S") return false;
  return /^[A-RT-Z]$/.test(upper);
}

// ------------------------------
// Validation
// ------------------------------

export function isLikelyUnitLabel(unit: string, hasStrongEvidence: boolean = false): boolean {
  if (!unit) return false;
  const upper = unit.toUpperCase();
  if (upper.length > 8) return false;

  // Floor-only patterns
  for (const p of FLOOR_ONLY_PATTERNS) {
    if (p.test(upper)) return false;
  }

  // Job/permit numbers
  for (const p of JOB_NUMBER_PATTERNS) {
    if (p.test(upper)) return false;
  }

  // ZIP code
  if (/^\d{5}$/.test(upper)) return false;

  // Ordinals like 6TH / 12TH / 1ST etc. (must be rejected even though they look like digit+letters)
  if (/^\d{1,3}(ST|ND|RD|TH)$/.test(upper)) return false;

  // 1) ALWAYS allow digit+letter (1–3 digits + 1–2 letters)
  // Examples: 6G, 4J, 12B, 100A, 12AA
  if (/^[1-9]\d{0,2}[A-Z]{1,2}$/.test(upper)) {
    // reject address-ish suffixes when used as the letter part: 12ST, 8AVE, etc.
    const m = upper.match(/^(\d{1,3})([A-Z]{1,2})$/);
    const suffix = m?.[2] ?? "";
    if (ADDRESS_SUFFIXES.includes(suffix)) return false;
    if (ORDINAL_SUFFIXES.includes(suffix)) return false; // redundant safety
    return true;
  }

  // 2) Numeric-only (1–3 digits): allow ONLY with strong evidence
  if (/^[1-9]\d{0,2}$/.test(upper)) {
    return hasStrongEvidence;
  }

  // 3) Single-letter token
  if (/^[A-Z]$/.test(upper)) {
    return isAllowedSingleLetterUnit(upper, hasStrongEvidence);
  }

  // 4) Pure alpha tokens: allow only known special tokens (PH/TH/GF/etc.)
  if (/^[A-Z]+$/.test(upper)) {
    return isAllowedSpecialToken(upper);
  }

  // 5) Stoplist: only meaningful for alpha-only tokens, but keep as safety
  if (!/\d/.test(upper) && isStopword(upper)) return false;

  // 6) Rare pattern: A12 (letter+digits) – allow
  if (/^[A-Z]\d{1,3}$/.test(upper)) return true;

  return false;
}

// ------------------------------
// Normalization
// ------------------------------

export function normalizeUnit(
  raw: string | null | undefined,
  relaxed: boolean = false,
  hasStrongEvidence: boolean = false,
): string | null {
  if (raw == null) return null;
  const rawStr = String(raw);

  const reject = (reason: string, extra?: Record<string, unknown>) => {
    debugLog("UnitNormalize.reject", {
      raw: rawStr.slice(0, 80),
      relaxed,
      hasStrongEvidence,
      reason,
      ...(extra ?? {}),
    });
    return null;
  };

  // 1) Trim + uppercase
  let value = rawStr.trim().toUpperCase();
  if (!value) return null;

  // 2) Early junk
  if (JUNK_VALUES.has(value)) return reject("junk_early", { value });

  // 3) Address substring reject (pre-prefix strip)
  if (containsAddressSubstring(value)) return reject("address_substring", { value });

  // 4) Strip prefixes FIRST
  const prefixPattern = new RegExp(`^(${STRIP_PREFIXES.join("|")})\\s*[:\\-\\.\\s]*`, "i");
  value = value.replace(prefixPattern, "");

  // 5) Collapse whitespace/hyphens/dots between characters
  value = value.replace(/[\s\-\.]+/g, "");

  // 6) Remove remaining punctuation except alphanumerics
  value = value.replace(/[^A-Z0-9]/g, "");

  // 7) Post-clean junk
  if (!value) return reject("empty_after_clean");
  if (JUNK_VALUES.has(value)) return reject("junk_after_clean", { value });

  // 8) STOPLIST only for alpha-only tokens (no digits)
  if (!/\d/.test(value) && isStopword(value)) {
    return reject("stopword_alpha_only", { value });
  }

  // 9) Validate
  const ok = isLikelyUnitLabel(value, hasStrongEvidence);
  if (!ok) {
    return reject("failed_validation", { value });
  }

  debugLog("UnitNormalize.accept", { raw: rawStr.slice(0, 80), value, hasStrongEvidence });
  return value;
}

// ------------------------------
// Extraction helpers
// ------------------------------

function determineUnitTypeFromField(fieldName: string, normalizedUnit: string): UnitType {
  const lower = fieldName.toLowerCase();
  const u = normalizedUnit.toUpperCase();
  if (u.startsWith("PH") || PENTHOUSE_TOKENS.has(u)) return "PH";
  if (lower.includes("apt") || lower.includes("apartment")) return "APT";
  if (lower.includes("unit")) return "UNIT";
  return "UNKNOWN";
}

function determineConfidence(
  extractionMethod: "direct" | "pattern",
  reason: string,
): { confidence: UnitConfidence; reason: string } {
  if (extractionMethod === "direct") return { confidence: "high", reason };
  return { confidence: "medium", reason };
}

const UNIT_FIELDS = [
  "apartment",
  "apt",
  "apt_no",
  "apartment_number",
  "apartmentnumber",
  "apartmentno",
  "apt_num",
  "apt_number",
  "unit",
  "unit_number",
  "unitnumber",
];

const TEXT_EXTRACTION_FIELDS = [
  "descriptor",
  "resolution_description",
  "complaint_type",
  "problem_description",
  "minorcat",
  "spacetype",
  "job_description",
  "jobdescription",
  "comments",
  "description",
  "violation_description",
  "ecb_violation_description",
];

// Explicit "strong evidence" patterns (APT/UNIT/#/RM/STE/etc.)
const UNIT_EXTRACTION_PATTERNS: { pattern: RegExp; keyword: string; strong: boolean }[] = [
  { pattern: /\bAPT\.?\s*#?\s*([A-Z0-9]{1,8})\b/i, keyword: "APT", strong: true },
  { pattern: /\bAPARTMENT\s*#?\s*([A-Z0-9]{1,8})\b/i, keyword: "APARTMENT", strong: true },
  { pattern: /\bUNIT\s*#?\s*([A-Z0-9]{1,8})\b/i, keyword: "UNIT", strong: true },
  { pattern: /\bRM\.?\s*#?\s*([A-Z0-9]{1,8})\b/i, keyword: "RM", strong: true },
  { pattern: /\bROOM\s*#?\s*([A-Z0-9]{1,8})\b/i, keyword: "ROOM", strong: true },
  { pattern: /\bSTE\.?\s*#?\s*([A-Z0-9]{1,8})\b/i, keyword: "STE", strong: true },
  { pattern: /\bSUITE\s*#?\s*([A-Z0-9]{1,8})\b/i, keyword: "SUITE", strong: true },
  { pattern: /#\s*([A-Z0-9]{1,8})\b/i, keyword: "#", strong: true },
  // PH / PENTHOUSE are special tokens
  { pattern: /\bPENTHOUSE\s*([A-Z0-9]{0,3})\b/i, keyword: "PENTHOUSE", strong: true },
  { pattern: /\bPH\s*([A-Z0-9]{0,3})\b/i, keyword: "PH", strong: true },
];

/**
 * Extract from free text.
 *
 * IMPORTANT CHANGE: We also support "bare" digit+letter tokens (6G, 12B, 100A, 12AA)
 * as weak evidence, because many datasets mention units without the APT/UNIT/# prefixes.
 *
 * This does NOT allow numeric-only tokens (12/100) because isLikelyUnitLabel blocks them
 * unless hasStrongEvidence is true.
 */
function extractUnitFromText(text: string | null | undefined, fieldName: string): UnitExtractionResult | null {
  if (!text) return null;
  const s = String(text);

  // 1) Strong evidence: explicit prefixes only
  for (const { pattern, keyword, strong } of UNIT_EXTRACTION_PATTERNS) {
    const match = s.match(pattern);
    if (!match) continue;

    const rawToken = (match[1] ?? "").toUpperCase();
    let normalized: string | null = null;

    if (keyword === "PENTHOUSE" || keyword === "PH") {
      const suffix = rawToken ? rawToken.replace(/^PH/i, "") : "";
      const ph = `PH${suffix}`.replace(/^PH$/, "PH");
      if (!isLikelyUnitLabel(ph, true)) continue;
      normalized = ph;
    } else {
      normalized = normalizeUnit(rawToken, false, strong);
      if (!normalized) continue;
    }

    const idx = match.index ?? 0;
    const start = Math.max(0, idx - 30);
    const end = Math.min(s.length, idx + match[0].length + 30);
    const snippet = (start > 0 ? "…" : "") + s.slice(start, end).trim() + (end < s.length ? "…" : "");

    debugLog("UnitExtract.accept_text", { fieldName, keyword, rawToken, normalized, strong });

    const { confidence, reason } = determineConfidence("pattern", `Explicit ${keyword} prefix`);
    return {
      normalizedUnit: normalized,
      asReported: match[0].trim(),
      sourceField: fieldName,
      snippet,
      unitType: keyword === "UNIT" ? "UNIT" : keyword === "PH" || keyword === "PENTHOUSE" ? "PH" : "APT",
      confidence,
      confidenceReason: reason,
    };
  }

  // 2) Weak evidence fallback: bare digit+letter tokens in free text (6G, 12B, 100A, 12AA)
  const bareUnitRegex = /\b([1-9]\d{0,2}[A-Z]{1,2})\b/g;
  let m: RegExpExecArray | null;

  while ((m = bareUnitRegex.exec(s)) !== null) {
    const rawToken = (m[1] ?? "").toUpperCase();
    const normalized = normalizeUnit(rawToken, false, false);
    if (!normalized) continue;

    const idx = m.index ?? 0;
    const start = Math.max(0, idx - 30);
    const end = Math.min(s.length, idx + rawToken.length + 30);
    const snippet = (start > 0 ? "…" : "") + s.slice(start, end).trim() + (end < s.length ? "…" : "");

    debugLog("UnitExtract.accept_text_weak", { fieldName, rawToken, normalized });

    const { confidence, reason } = determineConfidence("pattern", "Bare digit+letter token in text");
    return {
      normalizedUnit: normalized,
      asReported: rawToken,
      sourceField: fieldName,
      snippet,
      unitType: "UNKNOWN",
      confidence,
      confidenceReason: reason,
    };
  }

  return null;
}

function flattenRecordToStrings(record: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(record)) {
    if (v == null) continue;
    if (typeof v === "string") out.set(k, v);
    else if (typeof v === "number" || typeof v === "boolean") out.set(k, String(v));
    else if (typeof v === "object") {
      try {
        const json = JSON.stringify(v);
        out.set(k, json.length > 800 ? json.slice(0, 800) : json);
      } catch {
        // ignore circular
      }
    }
  }
  return out;
}

export function extractUnitFromRecordWithTrace(
  record: Record<string, unknown> | null | undefined,
): UnitExtractionResult | null {
  if (!record) return null;

  const flat = flattenRecordToStrings(record);

  // case-insensitive lookup
  const lowerKeyMap = new Map<string, string>();
  for (const key of flat.keys()) lowerKeyMap.set(key.toLowerCase(), key);

  // Direct fields (strong evidence)
  for (const field of UNIT_FIELDS) {
    const actualKey = lowerKeyMap.get(field.toLowerCase());
    if (!actualKey) continue;
    const value = flat.get(actualKey);
    if (!value) continue;

    const normalized = normalizeUnit(value, false, true);
    if (!normalized) {
      debugLog("UnitExtract.reject_direct", { field: actualKey, value });
      continue;
    }

    debugLog("UnitExtract.accept_direct", { field: actualKey, value, normalized });

    const { confidence, reason } = determineConfidence("direct", "Direct apartment/unit field");
    return {
      normalizedUnit: normalized,
      asReported: value.trim().toUpperCase(),
      sourceField: actualKey,
      snippet: null,
      unitType: determineUnitTypeFromField(actualKey, normalized),
      confidence,
      confidenceReason: reason,
    };
  }

  // Pattern extraction from known text fields
  for (const field of TEXT_EXTRACTION_FIELDS) {
    const actualKey = lowerKeyMap.get(field.toLowerCase());
    if (!actualKey) continue;
    const value = flat.get(actualKey);
    if (!value) continue;

    const extracted = extractUnitFromText(value, actualKey);
    if (extracted) return extracted;
  }

  // Fallback: scan all fields
  for (const [k, v] of flat.entries()) {
    if (!v || v.length > 1500) continue;
    if (UNIT_FIELDS.some((f) => f.toLowerCase() === k.toLowerCase())) continue;
    if (TEXT_EXTRACTION_FIELDS.some((f) => f.toLowerCase() === k.toLowerCase())) continue;

    const extracted = extractUnitFromText(v, k);
    if (extracted) return extracted;
  }

  return null;
}

export function extractUnitFromRecord(record: Record<string, unknown> | null | undefined): string | null {
  return extractUnitFromRecordWithTrace(record)?.normalizedUnit ?? null;
}

// ------------------------------
// Candidate extraction (for diagnostics UI)
// ------------------------------

/**
 * Extract unit-like candidates from free text for diagnostics ONLY.
 * IMPORTANT:
 * - This function MUST NOT decide acceptance. It only returns candidates.
 * - Validation remains exclusively in normalizeUnit() + isLikelyUnitLabel().
 */
const UNIT_CANDIDATE_REGEXES: Array<{ pattern: RegExp; strong: boolean }> = [
  // Strong evidence: explicit prefixes
  { pattern: /\b(?:APT|APARTMENT)\.?\s*#?\s*([0-9]{1,3}\s*[A-Z]{0,2}|PHH?|TH|GF|BS)\b/gi, strong: true },
  { pattern: /\bUNIT\.?\s*#?\s*([0-9]{1,3}\s*[A-Z]{0,2}|PHH?|TH|GF|BS)\b/gi, strong: true },
  { pattern: /\b(?:RM|ROOM)\.?\s*#?\s*([0-9]{1,3}\s*[A-Z]{0,2}|PHH?|TH|GF|BS)\b/gi, strong: true },
  { pattern: /\b(?:STE|SUITE)\.?\s*#?\s*([0-9]{1,3}\s*[A-Z]{0,2}|PHH?|TH|GF|BS)\b/gi, strong: true },
  { pattern: /#\s*([0-9]{1,3}\s*[A-Z]{0,2}|PHH?|TH|GF|BS)\b/gi, strong: true },
  // PH/PENTHOUSE patterns
  { pattern: /\bPENTHOUSE\s*([A-Z0-9]{0,3})\b/gi, strong: true },
  { pattern: /\bPH\s*([A-Z0-9]{0,3})\b/gi, strong: true },
  // Weak evidence: bare digit+letter (diagnostics only)
  { pattern: /\b([0-9]{1,3}[A-Z]{1,2})\b/g, strong: false },
];

/**
 * Exported because UnitExtractionDiagnostics imports it.
 * Returns candidates as { token, strong } pairs.
 */
export function extractUnitCandidatesFromText(text: string): Array<{ token: string; strong: boolean }> {
  const out: Array<{ token: string; strong: boolean }> = [];
  const seen = new Set<string>();

  for (const { pattern, strong } of UNIT_CANDIDATE_REGEXES) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const fullMatch = (m[0] ?? "").toUpperCase();
      const raw = (m[1] ?? "").toUpperCase().replace(/\s+/g, "");

      if (!raw && !fullMatch.includes("PENTHOUSE") && !/\bPH\b/.test(fullMatch)) continue;

      // Normalize PH forms into PH / PHH / etc.
      let token = raw;
      if (fullMatch.includes("PENTHOUSE") || /\bPH\b/.test(fullMatch)) {
        const suffix = raw ? raw.replace(/^PH/i, "") : "";
        token = `PH${suffix}`.replace(/^PH$/, "PH");
      }

      const key = `${token}|${strong ? "strong" : "weak"}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ token, strong });
    }
  }

  return out;
}

// ============================================================================
// PUBLIC HELPERS (exported API expected by other modules)
// ============================================================================

/**
 * Group records by extracted unit.
 * Records with no extractable unit are grouped under the null key.
 */
export function groupRecordsByUnit<T extends Record<string, unknown>>(records: T[]): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const record of records) {
    const unit = extractUnitFromRecord(record);
    const arr = groups.get(unit) ?? [];
    arr.push(record);
    groups.set(unit, arr);
  }
  return groups;
}

export interface UnitStats {
  unit: string;
  count: number;
  lastActivity: Date | null;
}

/**
 * Aggregate per-unit counts + latest date seen in the provided dateField.
 */
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

/**
 * Filter records to those that match a specific unit context.
 * If unitContext is null/empty/invalid, returns the original array.
 */
export function filterRecordsByUnit<T extends Record<string, unknown>>(records: T[], unitContext: string | null): T[] {
  if (!unitContext) return records;
  // IMPORTANT: unit context is a user-selected filter; treat as "strong evidence"
  // so numeric-only contexts (e.g., "12") can still function in the UI.
  const normalizedContext = normalizeUnit(unitContext, false, true);
  if (!normalizedContext) return records;
  return records.filter((record) => extractUnitFromRecord(record) === normalizedContext);
}

/**
 * Convenience helper used by UI for highlighting.
 */
export function recordMentionsUnit(
  record: Record<string, unknown> | null | undefined,
  unitContext: string | null,
): boolean {
  if (!record || !unitContext) return false;
  // Same rationale as filterRecordsByUnit: UI context should be treated as strong.
  const normalizedContext = normalizeUnit(unitContext, false, true);
  if (!normalizedContext) return false;
  const recordUnit = extractUnitFromRecord(record);
  return recordUnit === normalizedContext;
}

// ------------------------------
// DEV globals for sanity / tests
// ------------------------------

function runSanity(): Record<string, unknown> {
  const cases: Array<{ name: string; got: boolean; want: boolean }> = [
    { name: "6G digit+letter allowed", got: isLikelyUnitLabel("6G", false), want: true },
    { name: "12B digit+letter allowed", got: isLikelyUnitLabel("12B", false), want: true },
    { name: "12AA digit+letter allowed", got: isLikelyUnitLabel("12AA", false), want: true },
    { name: "12 numeric-only requires evidence (false)", got: isLikelyUnitLabel("12", false), want: false },
    { name: "12 numeric-only requires evidence (true)", got: isLikelyUnitLabel("12", true), want: true },
    { name: "6TH ordinal rejected", got: isLikelyUnitLabel("6TH", true), want: false },
    { name: "12TH ordinal rejected", got: isLikelyUnitLabel("12TH", true), want: false },
  ];
  const failures = cases.filter((c) => c.got !== c.want);
  return { ok: failures.length === 0, failures, cases };
}

declare global {
  interface Window {
    runUnitSanityChecks?: () => void;
    runUnitExtractionTests?: () => void;
  }
}

if (typeof window !== "undefined" && (import.meta as any)?.env?.DEV) {
  window.runUnitSanityChecks = () => {
    const res = runSanity();
    console.log("[UnitSanity]", res);
  };
}
