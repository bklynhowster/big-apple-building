import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  extractUnitFromRecordWithTrace, 
  getUnitStats,
  type UnitConfidence,
  type UnitType
} from '@/utils/unit';
import type { HPDComplaintRecord, HPDViolationRecord } from '@/hooks/useHPD';
import type { ServiceRequestRecord } from '@/hooks/use311';
import type { UnitRosterEntry } from '@/hooks/useCoopUnitRoster';
import type { UnitFromFilings, FilingReference } from '@/hooks/useDobJobFilings';
import type { ViolationRecord } from '@/hooks/useViolations';
import type { ECBRecord } from '@/hooks/useECB';
import type { PermitRecord } from '@/hooks/usePermits';

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
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_KEY_PREFIX = 'unit_mentions_cache_';

// Debug mode - set to true to enable console logging
const DEBUG_MODE = process.env.NODE_ENV === 'development';

// Debug stats collector
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
// CACHE HELPERS
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

function saveToCache(bbl: string, stats: CombinedUnitStats[]): void {
  // BUGFIX: Don't cache empty results - they might be from incomplete loads
  if (stats.length === 0) {
    logDebug(`Not caching empty results for BBL ${bbl}`);
    return;
  }
  
  try {
    const cached: CachedResult = {
      bbl,
      stats,
      timestamp: Date.now(),
    };
    localStorage.setItem(getCacheKey(bbl), JSON.stringify(cached));
    logDebug(`Cached ${stats.length} units for BBL ${bbl}`);
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
      if (key?.startsWith(CACHE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
    logDebug('Cleared all unit mentions caches');
  }
}

// ============================================================================
// EXTRACTION HELPERS
// ============================================================================

function extractUnitFromRecord(record: Record<string, unknown>): string | null {
  const result = extractUnitFromRecordWithTrace(record);
  return result?.normalizedUnit ?? null;
}

function processFilingsUnits(
  dobFilingsUnits: UnitFromFilings[],
  unitMap: Map<string, CombinedUnitStats>
): void {
  logDebug(`Processing ${dobFilingsUnits.length} DOB filings units`);
  
  for (const filingsEntry of dobFilingsUnits) {
    const entry = getOrCreateUnit(unitMap, filingsEntry.unit);
    entry.filingsCount = filingsEntry.count;
    entry.totalCount += filingsEntry.count;
    entry.filingRefs = filingsEntry.filings;
    
    const lastSeenDate = filingsEntry.lastSeen ? new Date(filingsEntry.lastSeen) : null;
    if (lastSeenDate && !isNaN(lastSeenDate.getTime()) && 
        (!entry.lastActivity || lastSeenDate > entry.lastActivity)) {
      entry.lastActivity = lastSeenDate;
    }
    
    for (const filing of filingsEntry.filings.slice(0, 3)) {
      entry.sourceRefs.push({
        type: 'dob',
        id: filing.jobNumber,
        label: `Job #${filing.jobNumber}`,
      });
    }
  }
  
  logDebug(`After filings: ${unitMap.size} unique units`);
}

function processSalesUnits(
  salesUnits: UnitRosterEntry[],
  unitMap: Map<string, CombinedUnitStats>
): void {
  logDebug(`Processing ${salesUnits.length} sales units`);
  
  for (const salesEntry of salesUnits) {
    const entry = getOrCreateUnit(unitMap, salesEntry.unit);
    entry.salesCount = salesEntry.count;
    entry.totalCount += salesEntry.count;
    
    const lastSeenDate = salesEntry.lastSeen ? new Date(salesEntry.lastSeen) : null;
    if (lastSeenDate && !isNaN(lastSeenDate.getTime()) && 
        (!entry.lastActivity || lastSeenDate > entry.lastActivity)) {
      entry.lastActivity = lastSeenDate;
    }
  }
  
  logDebug(`After sales: ${unitMap.size} unique units`);
}

function processPermits(
  dobPermits: PermitRecord[],
  unitMap: Map<string, CombinedUnitStats>
): number {
  let processed = 0;
  for (const record of dobPermits) {
    const extraction = extractUnitFromRecordWithTrace(record.raw);
    if (extraction) {
      const entry = getOrCreateUnit(unitMap, extraction.normalizedUnit);
      entry.permitsCount += 1;
      entry.totalCount += 1;
      
      if (record.issueDate) {
        const issueDate = new Date(record.issueDate);
        if (!isNaN(issueDate.getTime()) && (!entry.lastActivity || issueDate > entry.lastActivity)) {
          entry.lastActivity = issueDate;
        }
      }
      
      if (entry.sourceRefs.filter(r => r.type === 'permit').length < 5) {
        const permitId = record.jobNumber || record.recordId;
        entry.sourceRefs.push({
          type: 'permit',
          id: permitId,
          label: record.jobNumber ? `Job #${record.jobNumber}` : `Permit #${record.recordId}`,
        });
      }
      
      entry.permitRefs.push({
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
    processed++;
  }
  return processed;
}

function processHPD(
  hpdViolations: HPDViolationRecord[],
  hpdComplaints: HPDComplaintRecord[],
  unitMap: Map<string, CombinedUnitStats>
): number {
  let processed = 0;
  
  logDebug(`Processing HPD: ${hpdViolations.length} violations, ${hpdComplaints.length} complaints`);
  
  // Process violations
  const hpdViolationStats = getUnitStats(hpdViolations.map(r => r.raw));
  logDebug(`HPD violations: ${hpdViolationStats.length} unique units found`);
  
  for (const stat of hpdViolationStats) {
    const entry = getOrCreateUnit(unitMap, stat.unit);
    entry.hpdCount += stat.count;
    entry.totalCount += stat.count;
    if (stat.lastActivity && (!entry.lastActivity || stat.lastActivity > entry.lastActivity)) {
      entry.lastActivity = stat.lastActivity;
    }
  }
  
  for (const record of hpdViolations) {
    const unit = extractUnitFromRecord(record.raw);
    if (unit && unitMap.has(unit)) {
      const entry = unitMap.get(unit)!;
      if (entry.sourceRefs.filter(r => r.type === 'hpd').length < 3) {
        entry.sourceRefs.push({
          type: 'hpd',
          id: record.recordId,
          label: `HPD Violation #${record.recordId}`,
        });
      }
    }
    processed++;
  }
  
  // Process complaints
  const hpdComplaintStats = getUnitStats(hpdComplaints.map(r => r.raw));
  logDebug(`HPD complaints: ${hpdComplaintStats.length} unique units found`);
  
  for (const stat of hpdComplaintStats) {
    const entry = getOrCreateUnit(unitMap, stat.unit);
    entry.hpdCount += stat.count;
    entry.totalCount += stat.count;
    if (stat.lastActivity && (!entry.lastActivity || stat.lastActivity > entry.lastActivity)) {
      entry.lastActivity = stat.lastActivity;
    }
  }
  
  for (const record of hpdComplaints) {
    const unit = extractUnitFromRecord(record.raw);
    if (unit && unitMap.has(unit)) {
      const entry = unitMap.get(unit)!;
      if (entry.sourceRefs.filter(r => r.type === 'hpd').length < 3) {
        entry.sourceRefs.push({
          type: 'hpd',
          id: record.recordId,
          label: `HPD Complaint #${record.recordId}`,
        });
      }
    }
    processed++;
  }
  
  logDebug(`After HPD: ${unitMap.size} unique units total`);
  return processed;
}

function process311(
  serviceRequests: ServiceRequestRecord[],
  unitMap: Map<string, CombinedUnitStats>
): number {
  let processed = 0;
  
  const stats = getUnitStats(serviceRequests.map(r => r.raw));
  for (const stat of stats) {
    const entry = getOrCreateUnit(unitMap, stat.unit);
    entry.threeOneOneCount = stat.count;
    entry.totalCount += stat.count;
    if (stat.lastActivity && (!entry.lastActivity || stat.lastActivity > entry.lastActivity)) {
      entry.lastActivity = stat.lastActivity;
    }
  }
  
  for (const record of serviceRequests) {
    const unit = extractUnitFromRecord(record.raw);
    if (unit && unitMap.has(unit)) {
      const entry = unitMap.get(unit)!;
      if (entry.sourceRefs.filter(r => r.type === '311').length < 3) {
        entry.sourceRefs.push({
          type: '311',
          id: record.recordId,
          label: `SR #${record.recordId}`,
        });
      }
    }
    processed++;
  }
  
  return processed;
}

function processViolations(
  dobViolations: ViolationRecord[],
  unitMap: Map<string, CombinedUnitStats>
): number {
  let processed = 0;
  
  for (const record of dobViolations) {
    const extraction = extractUnitFromRecordWithTrace(record.raw);
    if (extraction) {
      const entry = getOrCreateUnit(unitMap, extraction.normalizedUnit);
      entry.dobViolationsCount += 1;
      entry.totalCount += 1;
      
      if (record.issueDate) {
        const issueDate = new Date(record.issueDate);
        if (!isNaN(issueDate.getTime()) && (!entry.lastActivity || issueDate > entry.lastActivity)) {
          entry.lastActivity = issueDate;
        }
      }
      
      if (entry.sourceRefs.filter(r => r.type === 'dob-violation').length < 5) {
        entry.sourceRefs.push({
          type: 'dob-violation',
          id: record.recordId,
          label: `DOB Vio #${record.recordId}`,
        });
      }
      
      entry.violationRefs.push({
        type: 'dob-violation',
        id: record.recordId,
        label: `DOB Violation #${record.recordId}`,
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
    processed++;
  }
  
  return processed;
}

function processECB(
  ecbViolations: ECBRecord[],
  unitMap: Map<string, CombinedUnitStats>
): number {
  let processed = 0;
  
  for (const record of ecbViolations) {
    const extraction = extractUnitFromRecordWithTrace(record.raw);
    if (extraction) {
      const entry = getOrCreateUnit(unitMap, extraction.normalizedUnit);
      entry.ecbViolationsCount += 1;
      entry.totalCount += 1;
      
      if (record.issueDate) {
        const issueDate = new Date(record.issueDate);
        if (!isNaN(issueDate.getTime()) && (!entry.lastActivity || issueDate > entry.lastActivity)) {
          entry.lastActivity = issueDate;
        }
      }
      
      if (entry.sourceRefs.filter(r => r.type === 'ecb').length < 5) {
        entry.sourceRefs.push({
          type: 'ecb',
          id: record.recordId,
          label: `ECB #${record.recordId}`,
        });
      }
      
      entry.violationRefs.push({
        type: 'ecb',
        id: record.recordId,
        label: `ECB Violation #${record.recordId}`,
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
    processed++;
  }
  
  return processed;
}

function getOrCreateUnit(unitMap: Map<string, CombinedUnitStats>, unit: string): CombinedUnitStats {
  let entry = unitMap.get(unit);
  if (!entry) {
    entry = {
      unit,
      hpdCount: 0,
      threeOneOneCount: 0,
      salesCount: 0,
      filingsCount: 0,
      dobViolationsCount: 0,
      ecbViolationsCount: 0,
      permitsCount: 0,
      totalCount: 0,
      lastActivity: null,
      filingRefs: [],
      sourceRefs: [],
      violationRefs: [],
      permitRefs: [],
      overallConfidence: 'low',
      confidenceDetails: '',
    };
    unitMap.set(unit, entry);
  }
  return entry;
}

function calculateConfidence(stats: CombinedUnitStats[]): void {
  for (const stat of stats) {
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
  }
}

function filterAndSortStats(unitMap: Map<string, CombinedUnitStats>): CombinedUnitStats[] {
  const filtered = Array.from(unitMap.values()).filter(stat => {
    const hasTraceableSource = stat.filingsCount > 0 || stat.hpdCount > 0 || 
      stat.threeOneOneCount > 0 || stat.dobViolationsCount > 0 || 
      stat.ecbViolationsCount > 0 || stat.permitsCount > 0;
    return hasTraceableSource;
  });
  
  calculateConfidence(filtered);
  
  return filtered.sort((a, b) => {
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
}

// ============================================================================
// HOOK
// ============================================================================

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
  stopScanning: () => void;
  refreshData: () => void;
}

export function useUnitMentions(
  bbl: string,
  dataSources: DataSources,
  loadingStates: LoadingStates
): UseUnitMentionsResult {
  const [stats, setStats] = useState<CombinedUnitStats[]>([]);
  const [progress, setProgress] = useState<ScanProgress>({
    stage: 'idle',
    scanned: 0,
    total: 0,
    stageLabel: '',
    elapsedMs: 0,
  });
  const [isPaused, setIsPaused] = useState(false);
  const [isCached, setIsCached] = useState(false);
  
  const unitMapRef = useRef<Map<string, CombinedUnitStats>>(new Map());
  const abortRef = useRef(false);
  const startTimeRef = useRef<number>(Date.now());
  const lastBblRef = useRef<string>('');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Check cache on BBL change
  useEffect(() => {
    if (bbl !== lastBblRef.current) {
      lastBblRef.current = bbl;
      abortRef.current = false;
      setIsPaused(false);
      unitMapRef.current = new Map();
      
      const cached = loadFromCache(bbl);
      if (cached && cached.length > 0) {
        setStats(cached);
        setIsCached(true);
        setProgress({ stage: 'complete', scanned: 0, total: 0, stageLabel: 'Loaded from cache', elapsedMs: 0 });
      } else {
        setStats([]);
        setIsCached(false);
        startTimeRef.current = Date.now();
        setProgress({ stage: 'idle', scanned: 0, total: 0, stageLabel: 'Starting...', elapsedMs: 0 });
      }
    }
  }, [bbl]);
  
  // Update elapsed time
  useEffect(() => {
    if (progress.stage !== 'idle' && progress.stage !== 'complete' && progress.stage !== 'paused') {
      intervalRef.current = setInterval(() => {
        setProgress(p => ({ ...p, elapsedMs: Date.now() - startTimeRef.current }));
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
  }, [progress.stage]);
  
  // Stage 1: Process filings + sales (fast)
  useEffect(() => {
    if (abortRef.current || isCached || isPaused) return;
    if (loadingStates.filingsLoading) {
      setProgress(p => ({ ...p, stage: 'filings', stageLabel: 'Scanning DOB job filings...' }));
      return;
    }
    
    logDebug(`Stage 1 - Input data: filings=${dataSources.dobFilingsUnits.length}, sales=${dataSources.salesUnits.length}`);
    
    processFilingsUnits(dataSources.dobFilingsUnits, unitMapRef.current);
    processSalesUnits(dataSources.salesUnits, unitMapRef.current);
    
    const sorted = filterAndSortStats(unitMapRef.current);
    logDebug(`Stage 1 complete: ${sorted.length} units after filings/sales`);
    if (sorted.length > 0) {
      setStats(sorted);
    }
  }, [loadingStates.filingsLoading, dataSources.dobFilingsUnits, dataSources.salesUnits, isCached, isPaused]);
  
  // Stage 2: Process permits
  useEffect(() => {
    if (abortRef.current || isCached || isPaused) return;
    if (loadingStates.permitsLoading) {
      setProgress(p => ({ 
        ...p, 
        stage: 'permits', 
        stageLabel: 'Scanning permits...',
        total: p.total + dataSources.dobPermits.length,
      }));
      return;
    }
    
    if (dataSources.dobPermits.length > 0) {
      const processed = processPermits(dataSources.dobPermits, unitMapRef.current);
      setProgress(p => ({ ...p, scanned: p.scanned + processed }));
      
      const sorted = filterAndSortStats(unitMapRef.current);
      setStats(sorted);
    }
  }, [loadingStates.permitsLoading, dataSources.dobPermits, isCached, isPaused]);
  
  // Stage 3: Process HPD
  useEffect(() => {
    if (abortRef.current || isCached || isPaused) return;
    if (loadingStates.hpdLoading) {
      setProgress(p => ({ 
        ...p, 
        stage: 'hpd', 
        stageLabel: 'Scanning HPD complaints & violations...',
        total: p.total + dataSources.hpdViolations.length + dataSources.hpdComplaints.length,
      }));
      return;
    }
    
    if (dataSources.hpdViolations.length > 0 || dataSources.hpdComplaints.length > 0) {
      const processed = processHPD(dataSources.hpdViolations, dataSources.hpdComplaints, unitMapRef.current);
      setProgress(p => ({ ...p, scanned: p.scanned + processed }));
      
      const sorted = filterAndSortStats(unitMapRef.current);
      setStats(sorted);
    }
  }, [loadingStates.hpdLoading, dataSources.hpdViolations, dataSources.hpdComplaints, isCached, isPaused]);
  
  // Stage 4: Process 311
  useEffect(() => {
    if (abortRef.current || isCached || isPaused) return;
    if (loadingStates.threeOneOneLoading) {
      setProgress(p => ({ 
        ...p, 
        stage: '311', 
        stageLabel: 'Scanning 311 requests...',
        total: p.total + dataSources.serviceRequests.length,
      }));
      return;
    }
    
    if (dataSources.serviceRequests.length > 0) {
      const processed = process311(dataSources.serviceRequests, unitMapRef.current);
      setProgress(p => ({ ...p, scanned: p.scanned + processed }));
      
      const sorted = filterAndSortStats(unitMapRef.current);
      setStats(sorted);
    }
  }, [loadingStates.threeOneOneLoading, dataSources.serviceRequests, isCached, isPaused]);
  
  // Stage 5: Process DOB Violations (text-heavy)
  useEffect(() => {
    if (abortRef.current || isCached || isPaused) return;
    if (loadingStates.violationsLoading) {
      setProgress(p => ({ 
        ...p, 
        stage: 'violations', 
        stageLabel: 'Scanning DOB violations...',
        total: p.total + dataSources.dobViolations.length,
      }));
      return;
    }
    
    if (dataSources.dobViolations.length > 0) {
      const processed = processViolations(dataSources.dobViolations, unitMapRef.current);
      setProgress(p => ({ ...p, scanned: p.scanned + processed }));
      
      const sorted = filterAndSortStats(unitMapRef.current);
      setStats(sorted);
    }
  }, [loadingStates.violationsLoading, dataSources.dobViolations, isCached, isPaused]);
  
  // Stage 6: Process ECB (text-heavy)
  useEffect(() => {
    if (abortRef.current || isCached || isPaused) return;
    if (loadingStates.ecbLoading) {
      setProgress(p => ({ 
        ...p, 
        stage: 'ecb', 
        stageLabel: 'Scanning ECB violations...',
        total: p.total + dataSources.ecbViolations.length,
      }));
      return;
    }
    
    if (dataSources.ecbViolations.length > 0) {
      const processed = processECB(dataSources.ecbViolations, unitMapRef.current);
      setProgress(p => ({ ...p, scanned: p.scanned + processed }));
    }
    
    // Final results
    const sorted = filterAndSortStats(unitMapRef.current);
    setStats(sorted);
    
    // Check if all loading is complete
    const allDone = !loadingStates.filingsLoading && !loadingStates.permitsLoading && 
      !loadingStates.hpdLoading && !loadingStates.threeOneOneLoading && 
      !loadingStates.violationsLoading && !loadingStates.ecbLoading;
    
    if (allDone && !abortRef.current && !isPaused) {
      setProgress(p => ({ 
        ...p, 
        stage: 'complete', 
        stageLabel: 'Scan complete',
        elapsedMs: Date.now() - startTimeRef.current,
      }));
      
      // Cache results
      if (sorted.length > 0) {
        saveToCache(bbl, sorted);
      }
    }
  }, [loadingStates.ecbLoading, dataSources.ecbViolations, bbl, isCached, isPaused, loadingStates]);
  
  const isScanning = useMemo(() => {
    return progress.stage !== 'idle' && progress.stage !== 'complete' && progress.stage !== 'paused';
  }, [progress.stage]);
  
  const hasAnyData = useMemo(() => {
    return stats.length > 0 || 
      dataSources.dobFilingsUnits.length > 0 ||
      dataSources.dobPermits.length > 0 ||
      dataSources.hpdViolations.length > 0 ||
      dataSources.hpdComplaints.length > 0 ||
      dataSources.serviceRequests.length > 0 ||
      dataSources.dobViolations.length > 0 ||
      dataSources.ecbViolations.length > 0;
  }, [stats, dataSources]);
  
  const stopScanning = useCallback(() => {
    abortRef.current = true;
    setIsPaused(true);
    setProgress(p => ({ ...p, stage: 'paused', stageLabel: 'Scanning paused' }));
  }, []);
  
  const refreshData = useCallback(() => {
    // Clear cache and restart
    localStorage.removeItem(getCacheKey(bbl));
    abortRef.current = false;
    setIsPaused(false);
    setIsCached(false);
    unitMapRef.current = new Map();
    startTimeRef.current = Date.now();
    setStats([]);
    setProgress({ stage: 'idle', scanned: 0, total: 0, stageLabel: 'Restarting...', elapsedMs: 0 });
  }, [bbl]);
  
  return {
    stats,
    progress,
    isScanning,
    isPaused,
    isCached,
    hasAnyData,
    stopScanning,
    refreshData,
  };
}
