import { useMemo } from "react";
import { extractUnitCandidatesFromText, normalizeUnit, type UnitConfidence } from "@/utils/unit";

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
// SORTING
// ============================================================================

function naturalUnitSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true });
}

// ============================================================================
// HOOK
// ============================================================================

export function useRecordUnitMentions<T extends { raw: Record<string, unknown> }>(
  records: T[],
  coopUnitContext?: string | null,
): UseRecordUnitMentionsResult<T> {
  const normalizedContext = useMemo(() => {
    return coopUnitContext ? normalizeUnit(coopUnitContext, false, true) : null;
  }, [coopUnitContext]);

  const recordsWithMentions = useMemo(() => {
    return records.map((record) => {
      const mentions: UnitMention[] = [];
      const seen = new Set<string>();

      for (const [field, value] of Object.entries(record.raw)) {
        if (typeof value !== "string") continue;

        const candidates = extractUnitCandidatesFromText(value);

        for (const { token, strong } of candidates) {
          const normalized = normalizeUnit(token, false, strong);
          if (!normalized) continue;
          if (seen.has(normalized)) continue;

          seen.add(normalized);

          mentions.push({
            unit: normalized,
            sourceField: field,
            snippet: value.slice(0, 200),
            confidence: strong ? "high" : "medium",
            confidenceReason: strong ? "Explicit apartment/unit reference" : "Unit-like token in text",
          });
        }
      }

      const matchesContext = normalizedContext ? mentions.some((m) => m.unit === normalizedContext) : false;

      return {
        record,
        mentions,
        matchesContext,
      };
    });
  }, [records, normalizedContext]);

  const allMentionedUnits = useMemo(() => {
    const set = new Set<string>();
    for (const r of recordsWithMentions) {
      for (const m of r.mentions) set.add(m.unit);
    }
    return Array.from(set).sort(naturalUnitSort);
  }, [recordsWithMentions]);

  const recordsWithMentionsCount = useMemo(() => {
    return recordsWithMentions.filter((r) => r.mentions.length > 0).length;
  }, [recordsWithMentions]);

  const filterByUnit = (unit: string | null) => {
    if (!unit) return recordsWithMentions;
    const normalized = normalizeUnit(unit, false, true);
    if (!normalized) return recordsWithMentions;
    return recordsWithMentions.filter((r) => r.mentions.some((m) => m.unit === normalized));
  };

  const filterToMentionsOnly = () => recordsWithMentions.filter((r) => r.mentions.length > 0);

  return {
    recordsWithMentions,
    allMentionedUnits,
    recordsWithMentionsCount,
    filterByUnit,
    filterToMentionsOnly,
  };
}
