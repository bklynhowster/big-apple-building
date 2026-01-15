import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  extractUnitFromRecordWithTrace,
  getNumericUnitDebugStats,
  clearNumericUnitDebugStats,
  type UnitConfidence,
  type UnitType,
} from '@/utils/unit';
import type { HPDComplaintRecord, HPDViolationRecord } from '@/hooks/useHPD';
import type { ServiceRequestRecord } from '@/hooks/use311';
import type { UnitRosterEntry } from '@/hooks/useCoopUnitRoster';
import type { UnitFromFilings, FilingReference } from '@/hooks/useDobJobFilings';
import type { ViolationRecord } from '@/hooks/useViolations';
import type { ECBRecord } from '@/hooks/useECB';
import type { PermitRecord } from '@/hooks/usePermits';

// Unit-like patterns for fallback detection
const UNIT_PATTERN_INDICATORS = /\b(APT|APARTMENT|UNIT|#\d|PH|PENTHOUSE|FL\s*\d|RM|ROOM|STE|SUITE)\b/i;

// ============================================================================
// RECORD SHAPE ADAPTER (CRITICAL FIX)
// ============================================================================

/**
 * Canonicalize record shape BEFORE extraction.
 * 
 * Some dataset records have a `.raw` property containing the actual data,
 * while others are already flat records. This adapter normalizes them all
 * to ensure extractUnitFromRecordWithTrace receives the correct shape.
 * 
 * @param r - The record to normalize (may be wrapped or flat)
 * @returns The raw record data, or null if invalid
 */
function toRawRecord(r: unknown): Record<string, unknown> | null {
  if (!r || typeof r !== 'object') return null;
  const obj = r as Record<string, unknown>;
  const raw = obj.raw;
  // If the record has a .raw property that's a non-array object, use that
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  // Otherwise, the record itself is the raw data (or fallback to the whole object)
  return obj;
}

// ============================================================================
// TYPES
// ============================================================================

export type ScanStage = 'idle' | 'filings' | 'permits' | 'hpd' | '311' | 'violations' | 'ecb' | 'complete' | 'paused';

export interface ViolationMentionRef {
  type: 'dob-violation' | 'ecb';
  id: string;
  label: string;
  status: string;
  issueDate: string | null;
  description: string | null;
  sourceField: string | null;
  snippet: string | null;
  unitType: UnitType | null;
  confidence: UnitConfidence | null;
  confidenceReason: string | null;
}

export interface PermitMentionRef {
  type: 'permit';
  id: string;
  jobNumber: string | null;
  label: string;
  status: string;
  issueDate: string | null;
  description: string | null;
  sourceField: string | null;
  snippet: string | null;
  unitType: UnitType | null;
  confidence: UnitConfidence | null;
  confidenceReason: string | null;
}

export interface CombinedUnitStats {
  unit: string;
  hpdCount: number;
  threeOneOneCount: number;
  salesCount: number;
  filingsCount: number;
  dobViolationsCount: number;
  ecbViolationsCount: number;
  permitsCount: number;
  totalCount: number;
  lastActivity: Date | null;
  filingRefs: FilingReference[];
  sourceRefs: {
    type: 'dob' | 'hpd' | '311' | 'sales' | 'dob-violation' | 'ecb' | 'permit';
    id: string;
    label: string;
  }[];
  violationRefs: ViolationMentionRef[];
  permitRefs: PermitMentionRef[];
  overallConfidence: UnitConfidence;
  confidenceDetails: string;
}

export interface ScanProgress {
  stage: ScanStage;
  scanned: number;
  total: number;
  stageLabel: string;
  elapsedMs: number;
}

interface CachedResult {
  bbl: string;
  stats: CombinedUnitStats[];
  timestamp: number;
  totalRecordsScanned?: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
// Cache versioning to prevent "stuck at zero" after deployments
// BUMPED to v7 to invalidate caches after stricter numeric unit matching fix
const UNIT_MENTIONS_CACHE_VERSION = 7;
const CACHE_KEY_PREFIX = `unit_mentions_cache_v${UNIT_MENTIONS_CACHE_VERSION}_`;

// DEV-only debug mode (SSR-safe). Enabled only with ?debug=1.
const DEBUG_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

// ============================================================================
// SOURCE DIAGNOSTICS (DEV-only)
// ============================================================================

export interface SourceDiagnostics {
  source: string;
  recordsFetched: number;
  recordsConvertedToRaw: number;
  recordsWithAnyText: number;
  recordsWithCandidateTokens: number;
  recordsWithValidatedUnits: number;
  topExtractedUnits: Array<{ unit: string; count: number }>;
  topRejectedTokens: Array<{ token: string; reason: string; count: number }>;
  sampleRawKeys: string[];
}

export interface DiagnosticsReport {
  bbl: string;
  sources: SourceDiagnostics[];
  totalRecordsFetched: number;
  totalRecordsConvertedToRaw: number;
  totalValidatedUnits: number;
  cacheKey: string;
  cacheStatus: 'hit' | 'miss' | 'skipped-empty' | 'written';
}

let currentDiagnostics: DiagnosticsReport | null = null;

export function getDiagnosticsReport(): DiagnosticsReport | null {
  return currentDiagnostics;
}

export function clearDiagnosticsReport(): void {
  currentDiagnostics = null;
}

// Debug stats collector (legacy)
interface DebugStats {
  bbl: string;
  recordCounts: Record<string, number>;
  extractedCounts: Record<string, number>;
  rejectedCounts: Record<string, number>;
  sampleExtractions: Array<{ unit: string; source: string; field: string }>;
  sampleRejections: Array<{ raw: string; reason: string }>;
}

let lastDebugStats: DebugStats | null = null;

export function getDebugStats(): DebugStats | null {
  return lastDebugStats;
}

function logDebug(message: string, ...args: unknown[]): void {
  if (DEBUG_MODE) {
    console.log(`[UnitMentions] ${message}`, ...args);
  }
}

// ============================================================================
// CACHE HELPERS (with poisoning prevention)
// ============================================================================

function getCacheKey(bbl: string): string {
  return `${CACHE_KEY_PREFIX}${bbl}`;
}

function loadFromCache(bbl: string): CombinedUnitStats[] | null {
  try {
    const cached = localStorage.getItem(getCacheKey(bbl));
    if (!cached) return null;
    
    const parsed: CachedResult = JSON.parse(cached);
    if (parsed.bbl !== bbl) return null;
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(getCacheKey(bbl));
      logDebug(`Cache expired for BBL ${bbl}`);
      return null;
    }
    
    // BUGFIX: Don't return cached empty results - they might be from a failed load
    if (parsed.stats.length === 0) {
      logDebug(`Cache contains empty results for BBL ${bbl}, ignoring cache`);
      localStorage.removeItem(getCacheKey(bbl));
      return null;
    }
    
    logDebug(`Cache hit for BBL ${bbl}: ${parsed.stats.length} units`);
    
    // Restore Date objects
    return parsed.stats.map(stat => ({
      ...stat,
      lastActivity: stat.lastActivity ? new Date(stat.lastActivity) : null,
    }));
  } catch {
    return null;
  }
}

function saveToCache(bbl: string, stats: CombinedUnitStats[], totalRecordsScanned: number): void {
  // BUGFIX: Don't cache empty results if we actually scanned records
  if (stats.length === 0) {
    if (totalRecordsScanned > 0) {
      logDebug(`NOT caching empty results for BBL ${bbl} (scanned ${totalRecordsScanned} records - likely extraction issue)`);
      if (DEBUG_MODE) {
        console.warn(`[UnitMentions] CACHE POISONING PREVENTED: Would have cached 0 units despite scanning ${totalRecordsScanned} records`);
      }
    } else {
      logDebug(`Not caching empty results for BBL ${bbl} (no records to scan)`);
    }
    return;
  }
  
  try {
    const cached: CachedResult = {
      bbl,
      stats,
      timestamp: Date.now(),
      totalRecordsScanned,
    };
    localStorage.setItem(getCacheKey(bbl), JSON.stringify(cached));
    logDebug(`Cached ${stats.length} units for BBL ${bbl} (from ${totalRecordsScanned} records)`);
    
    if (currentDiagnostics) {
      currentDiagnostics.cacheStatus = 'written';
    }
  } catch {
    // localStorage full or disabled - ignore
  }
}

// Helper to clear cache for debugging
export function clearUnitMentionsCache(bbl?: string): void {
  if (bbl) {
    localStorage.removeItem(getCacheKey(bbl));
    logDebug(`Cleared cache for BBL ${bbl}`);
  } else {
    // Clear all unit mentions caches
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('unit_mentions_cache_') || key?.startsWith(CACHE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
    logDebug('Cleared all unit mentions caches');
  }
  
  // Also expose on window for easy debugging
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).clearUnitMentionsCache = clearUnitMentionsCache;
    (window as unknown as Record<string, unknown>).getUnitMentionsDiagnostics = getDiagnosticsReport;
  }
}

// ============================================================================
// STABLE ID HELPERS (for deduplication)
// ============================================================================

function getDobViolationStableId(record: ViolationRecord): string {
  const raw = toRawRecord(record);
  if (!raw) return record.recordId;
  const rawId =
    (raw.dob_violation_number as string | undefined) ||
    (raw.violation_number as string | undefined) ||
    (raw.violationid as string | undefined) ||
    (raw.isn_dob_bis_viol as string | undefined);
  return (rawId && String(rawId)) || record.recordId;
}

function getEcbStableId(record: ECBRecord): string {
  const raw = toRawRecord(record);
  if (!raw) return record.recordId;
  const rawId =
    (raw.ecb_violation_number as string | undefined) ||
    (raw.ecb_number as string | undefined) ||
    (raw.ecb_violation_no as string | undefined) ||
    (raw.isn_dob_bis_extract as string | undefined);
  return (rawId && String(rawId)) || record.recordId;
}

function getHPDStableId(record: HPDViolationRecord | HPDComplaintRecord): string {
  const raw = toRawRecord(record);
  if (!raw) return record.recordId;
  const rawId =
    (raw.violationid as string | undefined) ||
    (raw.violation_id as string | undefined) ||
    (raw.complaintid as string | undefined) ||
    (raw.complaint_id as string | undefined);
  return (rawId && String(rawId)) || record.recordId;
}

function getPermitStableId(record: PermitRecord): string {
  const raw = toRawRecord(record);
  if (!raw) return record.jobNumber || record.recordId;
  const rawId =
    (raw.job_number as string | undefined) ||
    (raw.jobnumber as string | undefined) ||
    (raw.permit_number as string | undefined) ||
    (raw.permitnumber as string | undefined);
  return (rawId && String(rawId)) || record.jobNumber || record.recordId;
}

function get311StableId(record: ServiceRequestRecord): string {
  const raw = toRawRecord(record);
  if (!raw) return record.recordId;
  const rawId =
    (raw.unique_key as string | undefined) ||
    (raw.service_request_id as string | undefined) ||
    (raw.sr_id as string | undefined);
  return (rawId && String(rawId)) || record.recordId;
}

// ============================================================================
// PURE COMPUTATION: Build unit stats from scratch with deduplication
// ============================================================================

interface UnitAccumulator {
  unit: string;
  hpdIds: Set<string>;
  threeOneOneIds: Set<string>;
  filingsCount: number;
  salesCount: number;
  dobViolationIds: Set<string>;
  ecbViolationIds: Set<string>;
  permitIds: Set<string>;
  lastActivity: Date | null;
  filingRefs: FilingReference[];
  sourceRefs: Map<string, { type: 'dob' | 'hpd' | '311' | 'sales' | 'dob-violation' | 'ecb' | 'permit'; id: string; label: string }>;
  violationRefs: Map<string, ViolationMentionRef>;
  permitRefs: Map<string, PermitMentionRef>;
}

function createEmptyAccumulator(unit: string): UnitAccumulator {
  return {
    unit,
    hpdIds: new Set(),
    threeOneOneIds: new Set(),
    filingsCount: 0,
    salesCount: 0,
    dobViolationIds: new Set(),
    ecbViolationIds: new Set(),
    permitIds: new Set(),
    lastActivity: null,
    filingRefs: [],
    sourceRefs: new Map(),
    violationRefs: new Map(),
    permitRefs: new Map(),
  };
}

function updateLastActivity(acc: UnitAccumulator, dateStr: string | null | undefined): void {
  if (!dateStr) return;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return;
  if (!acc.lastActivity || date > acc.lastActivity) {
    acc.lastActivity = date;
  }
}

interface DataSources {
  dobFilingsUnits: UnitFromFilings[];
  salesUnits: UnitRosterEntry[];
  dobPermits: PermitRecord[];
  hpdViolations: HPDViolationRecord[];
  hpdComplaints: HPDComplaintRecord[];
  serviceRequests: ServiceRequestRecord[];
  dobViolations: ViolationRecord[];
  ecbViolations: ECBRecord[];
}

/**
 * PURE FUNCTION: Compute unit stats from data sources.
 * Uses Set-based deduplication to ensure counts are idempotent.
 * This function can be called multiple times with the same data and will return the same results.
 */
function computeUnitStats(dataSources: DataSources): CombinedUnitStats[] {
  const unitMap = new Map<string, UnitAccumulator>();
  
  const getOrCreate = (unit: string): UnitAccumulator => {
    let acc = unitMap.get(unit);
    if (!acc) {
      acc = createEmptyAccumulator(unit);
      unitMap.set(unit, acc);
    }
    return acc;
  };
  
  // 1. Process DOB filings units (already aggregated by useDobJobFilings hook)
  for (const filingsEntry of dataSources.dobFilingsUnits) {
    const acc = getOrCreate(filingsEntry.unit);
    acc.filingsCount = filingsEntry.count; // Direct assignment, not +=
    acc.filingRefs = filingsEntry.filings;
    
    if (filingsEntry.lastSeen) {
      updateLastActivity(acc, filingsEntry.lastSeen);
    }
    
    // Add DOB source refs (limit to first 3)
    for (const filing of filingsEntry.filings.slice(0, 3)) {
      const refKey = `dob-${filing.jobNumber}`;
      if (!acc.sourceRefs.has(refKey)) {
        acc.sourceRefs.set(refKey, {
          type: 'dob',
          id: filing.jobNumber,
          label: `Job #${filing.jobNumber}`,
        });
      }
    }
  }
  
  // 2. Process sales units (already aggregated by useCoopUnitRoster hook)
  for (const salesEntry of dataSources.salesUnits) {
    const acc = getOrCreate(salesEntry.unit);
    acc.salesCount = salesEntry.count; // Direct assignment
    if (salesEntry.lastSeen) {
      updateLastActivity(acc, salesEntry.lastSeen);
    }
  }
  
  // 3. Process permits - dedupe by permit stable ID
  for (const record of dataSources.dobPermits) {
    const rawRecord = toRawRecord(record);
    if (!rawRecord) continue;
    
    const extraction = extractUnitFromRecordWithTrace(rawRecord);
    if (!extraction) continue;
    
    const acc = getOrCreate(extraction.normalizedUnit);
    const stableId = getPermitStableId(record);
    
    // Only count if not already seen
    if (!acc.permitIds.has(stableId)) {
      acc.permitIds.add(stableId);
      updateLastActivity(acc, record.issueDate);
      
      // Add source ref (limit to 5)
      if (acc.sourceRefs.size < 5) {
        const refKey = `permit-${stableId}`;
        if (!acc.sourceRefs.has(refKey)) {
          acc.sourceRefs.set(refKey, {
            type: 'permit',
            id: stableId,
            label: record.jobNumber ? `Job #${record.jobNumber}` : `Permit #${record.recordId}`,
          });
        }
      }
      
      // Add permit ref (deduped by stableId)
      if (!acc.permitRefs.has(stableId)) {
        acc.permitRefs.set(stableId, {
          type: 'permit',
          id: record.recordId,
          jobNumber: record.jobNumber,
          label: record.jobNumber ? `Job #${record.jobNumber}` : `Permit #${record.recordId}`,
          status: record.status,
          issueDate: record.issueDate,
          description: record.description,
          sourceField: extraction.sourceField,
          snippet: extraction.snippet,
          unitType: extraction.unitType,
          confidence: extraction.confidence,
          confidenceReason: extraction.confidenceReason,
        });
      }
    }
  }
  
  // 4. Process HPD violations - dedupe by HPD stable ID
  for (const record of dataSources.hpdViolations) {
    const rawRecord = toRawRecord(record);
    if (!rawRecord) continue;
    
    const extraction = extractUnitFromRecordWithTrace(rawRecord);
    if (!extraction) continue;
    
    const acc = getOrCreate(extraction.normalizedUnit);
    const stableId = getHPDStableId(record);
    
    if (!acc.hpdIds.has(stableId)) {
      acc.hpdIds.add(stableId);
      updateLastActivity(acc, record.issueDate);
      
      if (acc.sourceRefs.size < 3) {
        const refKey = `hpd-${stableId}`;
        if (!acc.sourceRefs.has(refKey)) {
          acc.sourceRefs.set(refKey, {
            type: 'hpd',
            id: stableId,
            label: `HPD Violation #${stableId}`,
          });
        }
      }
    }
  }
  
  // 5. Process HPD complaints - dedupe by HPD stable ID
  for (const record of dataSources.hpdComplaints) {
    const rawRecord = toRawRecord(record);
    if (!rawRecord) continue;
    
    const extraction = extractUnitFromRecordWithTrace(rawRecord);
    if (!extraction) continue;
    
    const acc = getOrCreate(extraction.normalizedUnit);
    const stableId = getHPDStableId(record);
    
    if (!acc.hpdIds.has(stableId)) {
      acc.hpdIds.add(stableId);
      updateLastActivity(acc, record.issueDate);
      
      if (acc.sourceRefs.size < 3) {
        const refKey = `hpd-${stableId}`;
        if (!acc.sourceRefs.has(refKey)) {
          acc.sourceRefs.set(refKey, {
            type: 'hpd',
            id: stableId,
            label: `HPD Complaint #${stableId}`,
          });
        }
      }
    }
  }
  
  // 6. Process 311 requests - dedupe by 311 stable ID
  for (const record of dataSources.serviceRequests) {
    const rawRecord = toRawRecord(record);
    if (!rawRecord) continue;
    
    const extraction = extractUnitFromRecordWithTrace(rawRecord);
    if (!extraction) continue;
    
    const acc = getOrCreate(extraction.normalizedUnit);
    const stableId = get311StableId(record);
    
    if (!acc.threeOneOneIds.has(stableId)) {
      acc.threeOneOneIds.add(stableId);
      updateLastActivity(acc, record.issueDate);
      
      if (acc.sourceRefs.size < 3) {
        const refKey = `311-${stableId}`;
        if (!acc.sourceRefs.has(refKey)) {
          acc.sourceRefs.set(refKey, {
            type: '311',
            id: stableId,
            label: `SR #${stableId}`,
          });
        }
      }
    }
  }
  
  // 7. Process DOB violations - dedupe by DOB violation stable ID
  for (const record of dataSources.dobViolations) {
    const rawRecord = toRawRecord(record);
    if (!rawRecord) continue;
    
    const extraction = extractUnitFromRecordWithTrace(rawRecord);
    if (!extraction) continue;
    
    const acc = getOrCreate(extraction.normalizedUnit);
    const stableId = getDobViolationStableId(record);
    
    if (!acc.dobViolationIds.has(stableId)) {
      acc.dobViolationIds.add(stableId);
      updateLastActivity(acc, record.issueDate);
      
      if (acc.sourceRefs.size < 5) {
        const refKey = `dob-violation-${stableId}`;
        if (!acc.sourceRefs.has(refKey)) {
          acc.sourceRefs.set(refKey, {
            type: 'dob-violation',
            id: stableId,
            label: `DOB Vio #${stableId}`,
          });
        }
      }
      
      // Add violation ref (deduped)
      if (!acc.violationRefs.has(stableId)) {
        acc.violationRefs.set(stableId, {
          type: 'dob-violation',
          id: record.recordId,
          label: `DOB Violation #${stableId}`,
          status: record.status,
          issueDate: record.issueDate,
          description: record.description,
          sourceField: extraction.sourceField,
          snippet: extraction.snippet,
          unitType: extraction.unitType,
          confidence: extraction.confidence,
          confidenceReason: extraction.confidenceReason,
        });
      }
    }
  }
  
  // 8. Process ECB violations - dedupe by ECB stable ID
  for (const record of dataSources.ecbViolations) {
    const rawRecord = toRawRecord(record);
    if (!rawRecord) continue;
    
    const extraction = extractUnitFromRecordWithTrace(rawRecord);
    if (!extraction) continue;
    
    const acc = getOrCreate(extraction.normalizedUnit);
    const stableId = getEcbStableId(record);
    
    if (!acc.ecbViolationIds.has(stableId)) {
      acc.ecbViolationIds.add(stableId);
      updateLastActivity(acc, record.issueDate);
      
      if (acc.sourceRefs.size < 5) {
        const refKey = `ecb-${stableId}`;
        if (!acc.sourceRefs.has(refKey)) {
          acc.sourceRefs.set(refKey, {
            type: 'ecb',
            id: stableId,
            label: `ECB #${stableId}`,
          });
        }
      }
      
      // Add violation ref (deduped)
      if (!acc.violationRefs.has(stableId)) {
        acc.violationRefs.set(stableId, {
          type: 'ecb',
          id: record.recordId,
          label: `ECB Violation #${stableId}`,
          status: record.status,
          issueDate: record.issueDate,
          description: record.description,
          sourceField: extraction.sourceField,
          snippet: extraction.snippet,
          unitType: extraction.unitType,
          confidence: extraction.confidence,
          confidenceReason: extraction.confidenceReason,
        });
      }
    }
  }
  
  // Convert accumulators to final stats
  const results: CombinedUnitStats[] = [];
  
  for (const acc of unitMap.values()) {
    // Counts derived from Set sizes (idempotent!)
    const hpdCount = acc.hpdIds.size;
    const threeOneOneCount = acc.threeOneOneIds.size;
    const dobViolationsCount = acc.dobViolationIds.size;
    const ecbViolationsCount = acc.ecbViolationIds.size;
    const permitsCount = acc.permitIds.size;
    const totalCount = hpdCount + threeOneOneCount + acc.filingsCount + acc.salesCount + 
                       dobViolationsCount + ecbViolationsCount + permitsCount;
    
    // Skip units with no traceable sources
    if (totalCount === 0) continue;
    
    const stat: CombinedUnitStats = {
      unit: acc.unit,
      hpdCount,
      threeOneOneCount,
      salesCount: acc.salesCount,
      filingsCount: acc.filingsCount,
      dobViolationsCount,
      ecbViolationsCount,
      permitsCount,
      totalCount,
      lastActivity: acc.lastActivity,
      filingRefs: acc.filingRefs,
      sourceRefs: Array.from(acc.sourceRefs.values()),
      violationRefs: Array.from(acc.violationRefs.values()),
      permitRefs: Array.from(acc.permitRefs.values()),
      overallConfidence: 'low',
      confidenceDetails: '',
    };
    
    // Calculate confidence
    const allRefs = [...stat.violationRefs, ...stat.permitRefs];
    const highCount = allRefs.filter(r => r.confidence === 'high').length;
    const mediumCount = allRefs.filter(r => r.confidence === 'medium').length;
    
    const sourceTypes = [
      stat.filingsCount > 0,
      stat.hpdCount > 0,
      stat.threeOneOneCount > 0,
      stat.dobViolationsCount > 0,
      stat.ecbViolationsCount > 0,
      stat.permitsCount > 0,
    ].filter(Boolean).length;
    
    if (highCount >= 2 || (highCount >= 1 && sourceTypes >= 2)) {
      stat.overallConfidence = 'high';
      stat.confidenceDetails = `${highCount} high-confidence extraction${highCount !== 1 ? 's' : ''}, ${sourceTypes} source type${sourceTypes !== 1 ? 's' : ''}`;
    } else if (highCount >= 1 || mediumCount >= 2 || sourceTypes >= 2) {
      stat.overallConfidence = 'medium';
      stat.confidenceDetails = `${highCount} high, ${mediumCount} medium extractions`;
    } else {
      stat.overallConfidence = 'low';
      stat.confidenceDetails = 'Single source or ambiguous pattern';
    }
    
    results.push(stat);
  }
  
  // Sort by lastActivity desc, then by totalCount desc, then by unit name
  results.sort((a, b) => {
    if (a.lastActivity && b.lastActivity) {
      const dateDiff = b.lastActivity.getTime() - a.lastActivity.getTime();
      if (dateDiff !== 0) return dateDiff;
    } else if (a.lastActivity && !b.lastActivity) {
      return -1;
    } else if (!a.lastActivity && b.lastActivity) {
      return 1;
    }
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    return a.unit.localeCompare(b.unit, undefined, { numeric: true });
  });
  
  return results;
}

// ============================================================================
// HOOK
// ============================================================================

interface LoadingStates {
  filingsLoading: boolean;
  permitsLoading: boolean;
  hpdLoading: boolean;
  threeOneOneLoading: boolean;
  violationsLoading: boolean;
  ecbLoading: boolean;
}

export interface UseUnitMentionsResult {
  stats: CombinedUnitStats[];
  progress: ScanProgress;
  isScanning: boolean;
  isPaused: boolean;
  isCached: boolean;
  hasAnyData: boolean;
  allLoadingComplete: boolean;
  totalSourceRecords: number;
  debugStats: {
    recordCounts: Record<string, number>;
    totalRecords: number;
    extractedUnits: number;
    allLoadingComplete: boolean;
    stage: ScanStage;
  };
  stopScanning: () => void;
  refreshData: () => void;
}

export function useUnitMentions(
  bbl: string,
  dataSources: DataSources,
  loadingStates: LoadingStates
): UseUnitMentionsResult {
  const [cachedStats, setCachedStats] = useState<CombinedUnitStats[] | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(0);
  
  const startTimeRef = useRef<number>(Date.now());
  const lastBblRef = useRef<string>('');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  
  // Check cache on BBL change
  useEffect(() => {
    if (bbl !== lastBblRef.current) {
      lastBblRef.current = bbl;
      setIsPaused(false);
      
      const cached = loadFromCache(bbl);
      if (cached && cached.length > 0) {
        setCachedStats(cached);
        setIsCached(true);
      } else {
        setCachedStats(null);
        setIsCached(false);
        startTimeRef.current = Date.now();
        setElapsedMs(0);
      }
    }
  }, [bbl]);
  
  // Determine if all loading states are complete
  const allLoadingComplete = useMemo(() => {
    return !loadingStates.filingsLoading && !loadingStates.permitsLoading && 
      !loadingStates.hpdLoading && !loadingStates.threeOneOneLoading && 
      !loadingStates.violationsLoading && !loadingStates.ecbLoading;
  }, [loadingStates]);
  
  // Compute stats as PURE FUNCTION of data (no mutable refs!)
  // This is the key fix: stats are always derived from current data, never accumulated
  const computedStats = useMemo(() => {
    // If we have cached stats and haven't forced a refresh, use cache
    if (cachedStats && isCached) {
      return cachedStats;
    }
    
    // If paused, don't recompute
    if (isPaused) {
      return cachedStats ?? [];
    }
    
    // Compute from scratch - completely idempotent
    return computeUnitStats(dataSources);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cachedStats,
    isCached,
    isPaused,
    forceRefresh,
    // Data sources - when these change, recompute
    dataSources.dobFilingsUnits,
    dataSources.salesUnits,
    dataSources.dobPermits,
    dataSources.hpdViolations,
    dataSources.hpdComplaints,
    dataSources.serviceRequests,
    dataSources.dobViolations,
    dataSources.ecbViolations,
  ]);
  
  // Count total source records
  const totalSourceRecords = useMemo(() => {
    return dataSources.dobFilingsUnits.length +
      dataSources.salesUnits.length +
      dataSources.dobPermits.length +
      dataSources.hpdViolations.length +
      dataSources.hpdComplaints.length +
      dataSources.serviceRequests.length +
      dataSources.dobViolations.length +
      dataSources.ecbViolations.length;
  }, [dataSources]);
  
  // Determine current stage based on loading states
  const stage = useMemo((): ScanStage => {
    if (isCached) return 'complete';
    if (isPaused) return 'paused';
    if (loadingStates.filingsLoading) return 'filings';
    if (loadingStates.permitsLoading) return 'permits';
    if (loadingStates.hpdLoading) return 'hpd';
    if (loadingStates.threeOneOneLoading) return '311';
    if (loadingStates.violationsLoading) return 'violations';
    if (loadingStates.ecbLoading) return 'ecb';
    if (allLoadingComplete) return 'complete';
    return 'idle';
  }, [loadingStates, allLoadingComplete, isCached, isPaused]);
  
  const stageLabel = useMemo(() => {
    switch (stage) {
      case 'filings': return 'Scanning DOB job filings...';
      case 'permits': return 'Scanning permits...';
      case 'hpd': return 'Scanning HPD complaints & violations...';
      case '311': return 'Scanning 311 requests...';
      case 'violations': return 'Scanning DOB violations...';
      case 'ecb': return 'Scanning ECB violations...';
      case 'complete': return isCached ? 'Loaded from cache' : 'Scan complete';
      case 'paused': return 'Scanning paused';
      default: return 'Starting...';
    }
  }, [stage, isCached]);
  
  // Update elapsed time
  useEffect(() => {
    if (stage !== 'idle' && stage !== 'complete' && stage !== 'paused') {
      intervalRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 500);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [stage]);
  
  // Cache results when complete
  useEffect(() => {
    if (allLoadingComplete && !isCached && !isPaused && computedStats.length > 0) {
      saveToCache(bbl, computedStats, totalSourceRecords);
      
      // FALLBACK CHECK: If we found 0 units but records have unit-like patterns, log a warning
      if (computedStats.length === 0 && totalSourceRecords > 0) {
        // Check a sample of records for unit-like patterns
        const sampleRecords: (Record<string, unknown> | null)[] = [];
        
        dataSources.hpdViolations.slice(0, 10).forEach(r => sampleRecords.push(toRawRecord(r)));
        dataSources.hpdComplaints.slice(0, 10).forEach(r => sampleRecords.push(toRawRecord(r)));
        dataSources.serviceRequests.slice(0, 10).forEach(r => sampleRecords.push(toRawRecord(r)));
        dataSources.dobViolations.slice(0, 10).forEach(r => sampleRecords.push(toRawRecord(r)));
        
        const validRecords = sampleRecords.filter(Boolean) as Record<string, unknown>[];
        
        let foundPatterns = 0;
        const patternExamples: string[] = [];
        
        for (const record of validRecords) {
          const textFields = Object.values(record).filter(v => typeof v === 'string') as string[];
          for (const text of textFields) {
            if (UNIT_PATTERN_INDICATORS.test(text)) {
              foundPatterns++;
              if (patternExamples.length < 3) {
                const match = text.match(UNIT_PATTERN_INDICATORS);
                if (match) {
                  patternExamples.push(`"...${text.substring(Math.max(0, match.index! - 20), match.index! + match[0].length + 20)}..."`);
                }
              }
              break;
            }
          }
        }
        
        if (foundPatterns > 0) {
          console.warn(
            `[UnitMentions] FALLBACK WARNING: Extracted 0 units from ${totalSourceRecords} records, ` +
            `but found ${foundPatterns} records with unit-like patterns in sample of ${validRecords.length}.\n` +
            `This may indicate overly strict validation. Sample patterns found:\n` +
            patternExamples.join('\n')
          );
        }
      }
    }
  }, [allLoadingComplete, isCached, isPaused, computedStats, bbl, totalSourceRecords, dataSources]);
  
  const progress = useMemo((): ScanProgress => ({
    stage,
    scanned: allLoadingComplete ? totalSourceRecords : 0,
    total: totalSourceRecords,
    stageLabel,
    elapsedMs: isCached ? 0 : elapsedMs,
  }), [stage, allLoadingComplete, totalSourceRecords, stageLabel, isCached, elapsedMs]);
  
  const isScanning = useMemo(() => {
    return stage !== 'idle' && stage !== 'complete' && stage !== 'paused';
  }, [stage]);
  
  const hasAnyData = useMemo(() => {
    return computedStats.length > 0 || totalSourceRecords > 0;
  }, [computedStats, totalSourceRecords]);
  
  // Debug stats for troubleshooting
  const debugStats = useMemo(() => ({
    recordCounts: {
      dobFilingsUnits: dataSources.dobFilingsUnits.length,
      salesUnits: dataSources.salesUnits.length,
      dobPermits: dataSources.dobPermits.length,
      hpdViolations: dataSources.hpdViolations.length,
      hpdComplaints: dataSources.hpdComplaints.length,
      serviceRequests: dataSources.serviceRequests.length,
      dobViolations: dataSources.dobViolations.length,
      ecbViolations: dataSources.ecbViolations.length,
    },
    totalRecords: totalSourceRecords,
    extractedUnits: computedStats.length,
    allLoadingComplete,
    stage,
  }), [dataSources, computedStats, totalSourceRecords, allLoadingComplete, stage]);

  // DEV-only: Debug panel data - comprehensive numeric unit debug output
  const debugPanelRef = useRef<{ logged: boolean; bbl: string }>({ logged: false, bbl: '' });
  useEffect(() => {
    if (!DEBUG_MODE) return;
    if (debugPanelRef.current.bbl === bbl && debugPanelRef.current.logged) return;
    if (!allLoadingComplete) return;
    
    // Clear previous debug stats before logging new ones
    clearNumericUnitDebugStats();
    
    // Get numeric unit debug stats from the extraction module
    const numericStats = getNumericUnitDebugStats();
    
    // Log comprehensive debug info
    console.group('[UnitMentions] DEBUG PANEL - ?debug=1');
    
    console.log('📊 EXTRACTION SUMMARY:', {
      totalRecordsScanned: totalSourceRecords,
      uniqueUnitsFound: computedStats.length,
      sources: {
        dobViolations: dataSources.dobViolations.length,
        ecbViolations: dataSources.ecbViolations.length,
        hpdViolations: dataSources.hpdViolations.length,
        hpdComplaints: dataSources.hpdComplaints.length,
        serviceRequests311: dataSources.serviceRequests.length,
        permits: dataSources.dobPermits.length,
      }
    });
    
    // Log per-unit counts
    if (computedStats.length > 0) {
      console.log('📋 TOP UNITS BY VIO COUNT:');
      const sortedByVio = [...computedStats]
        .sort((a, b) => (b.dobViolationsCount + b.ecbViolationsCount) - (a.dobViolationsCount + a.ecbViolationsCount))
        .slice(0, 10);
      
      sortedByVio.forEach(stat => {
        const vioTotal = stat.dobViolationsCount + stat.ecbViolationsCount;
        console.log(`  Unit "${stat.unit}": VIO=${vioTotal} (DOB=${stat.dobViolationsCount}, ECB=${stat.ecbViolationsCount}), HPD=${stat.hpdCount}, 311=${stat.threeOneOneCount}`);
      });
    }
    
    // Log numeric unit stats if any
    if (numericStats.length > 0) {
      console.log('🔢 NUMERIC UNIT DEBUG (units that are pure numbers):');
      numericStats.forEach(stat => {
        console.log(`  Unit "${stat.unitLabel}":`, {
          regexUsed: stat.regexUsed,
          matchesBySource: stat.matchesBySource,
          sampleSnippets: stat.sampleSnippets,
        });
      });
    } else {
      console.log('✅ No numeric-only units extracted (good for condo buildings with labels like 1, 2, 3)');
    }
    
    // Find unit "2" specifically if it exists (common false positive)
    const unit2 = computedStats.find(s => s.unit === '2');
    if (unit2) {
      console.warn('⚠️ UNIT "2" FOUND - potential false positive:', {
        vioCount: unit2.dobViolationsCount + unit2.ecbViolationsCount,
        hpdCount: unit2.hpdCount,
        threeOneOneCount: unit2.threeOneOneCount,
        violationRefs: unit2.violationRefs.slice(0, 5).map(r => ({
          id: r.id,
          sourceField: r.sourceField,
          snippet: r.snippet?.slice(0, 80),
        })),
      });
    }
    
    console.groupEnd();
    
    debugPanelRef.current = { logged: true, bbl };
  }, [allLoadingComplete, computedStats, bbl, totalSourceRecords, dataSources]);

  const stopScanning = useCallback(() => {
    setIsPaused(true);
  }, []);
  
  const refreshData = useCallback(() => {
    // Clear cache and restart
    localStorage.removeItem(getCacheKey(bbl));
    setIsPaused(false);
    setIsCached(false);
    setCachedStats(null);
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    setForceRefresh(prev => prev + 1); // Trigger recomputation
  }, [bbl]);
  
  return {
    stats: computedStats,
    progress,
    isScanning,
    isPaused,
    isCached,
    hasAnyData,
    allLoadingComplete,
    totalSourceRecords,
    debugStats,
    stopScanning,
    refreshData,
  };
}
