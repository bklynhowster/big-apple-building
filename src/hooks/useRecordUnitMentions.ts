import { useMemo } from "react";
import { extractUnitFromRecordWithTrace, normalizeUnit, type UnitConfidence } from "@/utils/unit";

// ============================================================================
// TYPES
// ============================================================================

export interface UnitMention {
  unit: string;
  sourceField: string;
  snippet: string | null;
  confidence: UnitConfidence;
  confidenceReason: string;
}

export interface RecordWithMentions<T> {
  record: T;
  mentions: UnitMention[];
  matchesContext: boolean;
}

export interface UseRecordUnitMentionsResult<T> {
  recordsWithMentions: RecordWithMentions<T>[];
  allMentionedUnits: string[];
  recordsWithMentionsCount: number;
  filterByUnit: (unit: string | null) => RecordWithMentions<T>[];
  filterToMentionsOnly: () => RecordWithMentions<T>[];
}

// ============================================================================
// NATURAL UNIT SORTING
// ============================================================================

const SPECIAL_UNITS = [
  "PH",
  "PHA",
  "PHB",
  "PHC",
  "PHD",
  "PENTHOUSE",
  "BSMT",
  "BASEMENT",
  "G",
  "GF",
  "L",
  "LL",
  "R",
  "REAR",
  "ROOF",
];

function parseUnitForSort(unit: string) {
  const upper = unit.toUpperCase();
  const isSpecial = SPECIAL_UNITS.some((s) => upper === s || upper.startsWith(s));

  const m = upper.match(/^(\d+)([A-Z]*)$/);
  if (m) {
    return {
      isSpecial: false,
      numeric: parseInt(m[1], 10),
      alpha: m[2] ?? "",
      original: upper,
    };
  }

  return {
    isSpecial,
    numeric: isSpecial ? Number.MAX_SAFE_INTEGER : 0,
    alpha: upper,
    original: upper,
  };
}

function compareUnitsNatural(a: string, b: string): number {
  const A = parseUnitForSort(a);
  const B = parseUnitForSort(b);

  if (A.isSpecial && !B.isSpecial) return 1;
  if (!A.isSpecial && B.isSpecial) return -1;
  if (A.numeric !== B.numeric) return A.numeric - B.numeric;
  return A.alpha.localeCompare(B.alpha);
}

// ============================================================================
// HOOK
// ============================================================================

export function useRecordUnitMentions<T extends { raw: Record<string, unknown> }>(
  records: T[],
  coopUnitContext?: string | null,
): UseRecordUnitMentionsResult<T> {
  const normalizedContext = useMemo(
    () => (coopUnitContext ? normalizeUnit(coopUnitContext, false, true) : null),
    [coopUnitContext],
  );

  // ------------------------------------------------------------
  // Extract mentions per record
  // ------------------------------------------------------------

  const recordsWithMentions = useMemo(() => {
    return records.map((record) => {
      const extraction = extractUnitFromRecordWithTrace(record.raw);
      const mentions: UnitMention[] = [];

      if (extraction) {
        mentions.push({
          unit: extraction.normalizedUnit,
          sourceField: extraction.sourceField,
          snippet: extraction.snippet,
          confidence: extraction.confidence,
          confidenceReason: extraction.confidenceReason,
        });
      }

      const matchesContext = normalizedContext ? mentions.some((m) => m.unit === normalizedContext) : false;

      return { record, mentions, matchesContext };
    });
  }, [records, normalizedContext]);

  // ------------------------------------------------------------
  // All mentioned units (global list)
  // ------------------------------------------------------------

  const allMentionedUnits = useMemo(() => {
    const set = new Set<string>();
    for (const r of recordsWithMentions) {
      for (const m of r.mentions) set.add(m.unit);
    }
    return Array.from(set).sort(compareUnitsNatural);
  }, [recordsWithMentions]);

  // ------------------------------------------------------------
  // FIXED: Context-aware count
  // ------------------------------------------------------------

  const recordsWithMentionsCount = useMemo(() => {
    if (!normalizedContext) {
      return recordsWithMentions.filter((r) => r.mentions.length > 0).length;
    }
    return recordsWithMentions.filter((r) => r.matchesContext).length;
  }, [recordsWithMentions, normalizedContext]);

  // ------------------------------------------------------------
  // Filter helpers
  // ------------------------------------------------------------

  const filterByUnit = useMemo(() => {
    return (unit: string | null) => {
      if (!unit) return recordsWithMentions;
      const normalized = normalizeUnit(unit, false, true);
      if (!normalized) return recordsWithMentions;
      return recordsWithMentions.filter((r) => r.mentions.some((m) => m.unit === normalized));
    };
  }, [recordsWithMentions]);

  const filterToMentionsOnly = useMemo(() => {
    return () => {
      if (!normalizedContext) {
        return recordsWithMentions.filter((r) => r.mentions.length > 0);
      }
      return recordsWithMentions.filter((r) => r.matchesContext);
    };
  }, [recordsWithMentions, normalizedContext]);

  return {
    recordsWithMentions,
    allMentionedUnits,
    recordsWithMentionsCount,
    filterByUnit,
    filterToMentionsOnly,
  };
}
