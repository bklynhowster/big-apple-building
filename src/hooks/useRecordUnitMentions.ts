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
// HELPERS
// ============================================================================

/**
 * Flatten an arbitrarily nested record into an array of strings.
 * This is REQUIRED because NYC records store unit text inside
 * nested objects and arrays.
 */
function flattenRecord(record: Record<string, unknown>): Array<{ text: string; field: string }> {
  const out: Array<{ text: string; field: string }> = [];

  const walk = (value: unknown, field: string) => {
    if (typeof value === "string") {
      out.push({ text: value, field });
    } else if (Array.isArray(value)) {
      for (const v of value) walk(v, field);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        walk(v, `${field}.${k}`);
      }
    }
  };

  for (const [key, value] of Object.entries(record)) {
    walk(value, key);
  }

  return out;
}

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
  // Normalize selected unit context (UI filter)
  const normalizedContext = useMemo(() => {
    return coopUnitContext ? normalizeUnit(coopUnitContext, false, true) : null;
  }, [coopUnitContext]);

  // --------------------------------------------------------------------------
  // Extract mentions from records
  // --------------------------------------------------------------------------

  const recordsWithMentions = useMemo(() => {
    return records.map((record) => {
      const mentions: UnitMention[] = [];
      const seen = new Set<string>();

      const flattened = flattenRecord(record.raw);

      for (const { text, field } of flattened) {
        const candidates = extractUnitCandidatesFromText(text);

        for (const { token, strong } of candidates) {
          const normalized = normalizeUnit(token, false, strong);
          if (!normalized) continue;
          if (seen.has(normalized)) continue;

          seen.add(normalized);

          mentions.push({
            unit: normalized,
            sourceField: field,
            snippet: text.slice(0, 200),
            confidence: strong ? "high" : "medium",
            confidenceReason: strong ? "Explicit apartment/unit reference" : "Unit-like token in record text",
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

  // --------------------------------------------------------------------------
  // Aggregates
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // Filters
  // --------------------------------------------------------------------------

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
