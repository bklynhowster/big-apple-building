import { useMemo } from 'react';
import { 
  extractUnitFromRecordWithTrace, 
  normalizeUnit,
  type UnitExtractionResult,
  type UnitConfidence 
} from '@/utils/unit';

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
  /** Records with their extracted unit mentions */
  recordsWithMentions: RecordWithMentions<T>[];
  /** All unique units mentioned across all records (sorted naturally) */
  allMentionedUnits: string[];
  /** Count of records that mention at least one unit */
  recordsWithMentionsCount: number;
  /** Filter records by a specific unit */
  filterByUnit: (unit: string | null) => RecordWithMentions<T>[];
  /** Filter to only records that mention any unit */
  filterToMentionsOnly: () => RecordWithMentions<T>[];
}

// ============================================================================
// NATURAL UNIT SORTING
// ============================================================================

const SPECIAL_UNITS = ['PH', 'PHA', 'PHB', 'PHC', 'PHD', 'PENTHOUSE', 'BSMT', 'BASEMENT', 'G', 'GF', 'L', 'LL', 'R', 'REAR', 'ROOF'];

function parseUnitForSort(unit: string): { isSpecial: boolean; numericPart: number; alphaPart: string; original: string } {
  const upperUnit = unit.toUpperCase().trim();
  const isSpecial = SPECIAL_UNITS.some(s => upperUnit === s || upperUnit.startsWith(s));
  
  const match = upperUnit.match(/^(\d+)([A-Z]*)$/);
  if (match) {
    return {
      isSpecial: false,
      numericPart: parseInt(match[1], 10),
      alphaPart: match[2] || '',
      original: upperUnit
    };
  }
  
  return {
    isSpecial,
    numericPart: isSpecial ? Number.MAX_SAFE_INTEGER : 0,
    alphaPart: upperUnit,
    original: upperUnit
  };
}

function compareUnitsNatural(a: string, b: string): number {
  const parsedA = parseUnitForSort(a);
  const parsedB = parseUnitForSort(b);
  
  if (parsedA.isSpecial && !parsedB.isSpecial) return 1;
  if (!parsedA.isSpecial && parsedB.isSpecial) return -1;
  if (parsedA.isSpecial && parsedB.isSpecial) return parsedA.original.localeCompare(parsedB.original);
  
  if (parsedA.numericPart !== parsedB.numericPart) return parsedA.numericPart - parsedB.numericPart;
  return parsedA.alphaPart.localeCompare(parsedB.alphaPart);
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to extract unit mentions from a list of records.
 * Memoizes extraction results by record to avoid re-parsing.
 * 
 * @param records Array of records with `raw` property containing the original data
 * @param coopUnitContext Optional unit context for highlighting matches
 * @returns Object with records enriched with mentions, and filtering utilities
 */
export function useRecordUnitMentions<T extends { raw: Record<string, unknown> }>(
  records: T[],
  coopUnitContext?: string | null
): UseRecordUnitMentionsResult<T> {
  
  const normalizedContext = useMemo(() => {
    return coopUnitContext ? normalizeUnit(coopUnitContext) : null;
  }, [coopUnitContext]);
  
  // Extract mentions from all records (memoized)
  const recordsWithMentions = useMemo(() => {
    return records.map(record => {
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
      
      const matchesContext = normalizedContext 
        ? mentions.some(m => m.unit === normalizedContext)
        : false;
      
      return {
        record,
        mentions,
        matchesContext,
      };
    });
  }, [records, normalizedContext]);
  
  // All unique mentioned units (sorted naturally)
  const allMentionedUnits = useMemo(() => {
    const unitSet = new Set<string>();
    for (const rwm of recordsWithMentions) {
      for (const mention of rwm.mentions) {
        unitSet.add(mention.unit);
      }
    }
    return Array.from(unitSet).sort(compareUnitsNatural);
  }, [recordsWithMentions]);
  
  // Count of records with at least one mention
  const recordsWithMentionsCount = useMemo(() => {
    return recordsWithMentions.filter(rwm => rwm.mentions.length > 0).length;
  }, [recordsWithMentions]);
  
  // Filter by specific unit
  const filterByUnit = useMemo(() => {
    return (unit: string | null): RecordWithMentions<T>[] => {
      if (!unit) return recordsWithMentions;
      const normalizedUnit = normalizeUnit(unit);
      if (!normalizedUnit) return recordsWithMentions;
      return recordsWithMentions.filter(rwm => 
        rwm.mentions.some(m => m.unit === normalizedUnit)
      );
    };
  }, [recordsWithMentions]);
  
  // Filter to mentions only
  const filterToMentionsOnly = useMemo(() => {
    return (): RecordWithMentions<T>[] => {
      return recordsWithMentions.filter(rwm => rwm.mentions.length > 0);
    };
  }, [recordsWithMentions]);
  
  return {
    recordsWithMentions,
    allMentionedUnits,
    recordsWithMentionsCount,
    filterByUnit,
    filterToMentionsOnly,
  };
}
