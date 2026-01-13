import { useMemo, useState, useCallback } from 'react';
import { Eye, Info, Users, AlertTriangle, Phone, FileText, ExternalLink, ChevronDown, ChevronUp, X, Shield, Loader2, RefreshCw, Pause, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  extractUnitFromRecord, 
  extractUnitFromRecordWithTrace,
  getUnitStats,
  type UnitStats,
  type UnitConfidence,
  type UnitType,
} from '@/utils/unit';
import { 
  useUnitMentions,
  type CombinedUnitStats,
  type ScanProgress,
} from '@/hooks/useUnitMentions';
import { UnitExtractionDiagnostics } from './UnitExtractionDiagnostics';
import type { HPDComplaintRecord, HPDViolationRecord } from '@/hooks/useHPD';
import type { ServiceRequestRecord } from '@/hooks/use311';
import type { UnitRosterEntry } from '@/hooks/useCoopUnitRoster';
import type { UnitFromFilings, FilingReference, JobFilingRecord } from '@/hooks/useDobJobFilings';
import type { ViolationRecord } from '@/hooks/useViolations';
import type { ECBRecord } from '@/hooks/useECB';
import type { PermitRecord } from '@/hooks/usePermits';

// ============================================================================
// SORTING TYPES & HELPERS
// ============================================================================

type SortField = 'unit' | 'lastActivity' | 'totalMentions';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

// Special unit patterns that should sort last
const SPECIAL_UNITS = ['PH', 'PHA', 'PHB', 'PHC', 'PHD', 'PENTHOUSE', 'BSMT', 'BASEMENT', 'G', 'GF', 'GND', 'GROUND', 'L', 'LL', 'LOWER', 'R', 'REAR', 'ROOF', 'STORE', 'COMMERCIAL'];

/**
 * Parse a unit string into components for natural sorting.
 * Handles patterns like: 1, 1A, 2, 2A, 2B, 10, 10A, PH, PHA, BSMT, etc.
 */
function parseUnitForSort(unit: string): { isSpecial: boolean; numericPart: number; alphaPart: string; original: string } {
  const upperUnit = unit.toUpperCase().trim();
  
  // Check if it's a special unit
  const isSpecial = SPECIAL_UNITS.some(s => upperUnit === s || upperUnit.startsWith(s));
  
  // Extract numeric and alpha parts
  const match = upperUnit.match(/^(\d+)([A-Z]*)$/);
  if (match) {
    return {
      isSpecial: false,
      numericPart: parseInt(match[1], 10),
      alphaPart: match[2] || '',
      original: upperUnit
    };
  }
  
  // For special units or non-standard formats
  return {
    isSpecial,
    numericPart: isSpecial ? Number.MAX_SAFE_INTEGER : 0,
    alphaPart: upperUnit,
    original: upperUnit
  };
}

/**
 * Compare two units using natural sort order:
 * - Numeric units first (1, 2, 3...)
 * - Alpha suffixes within same number (1A < 1B < 2)
 * - Special units (PH, BSMT, etc.) last
 */
function compareUnitsNatural(a: string, b: string): number {
  const parsedA = parseUnitForSort(a);
  const parsedB = parseUnitForSort(b);
  
  // Special units always sort last
  if (parsedA.isSpecial && !parsedB.isSpecial) return 1;
  if (!parsedA.isSpecial && parsedB.isSpecial) return -1;
  
  // Both special - sort alphabetically
  if (parsedA.isSpecial && parsedB.isSpecial) {
    return parsedA.original.localeCompare(parsedB.original);
  }
  
  // Compare numeric parts first
  if (parsedA.numericPart !== parsedB.numericPart) {
    return parsedA.numericPart - parsedB.numericPart;
  }
  
  // Same number - compare alpha suffixes
  return parsedA.alphaPart.localeCompare(parsedB.alphaPart);
}

/**
 * Sort combined unit stats based on sort config
 */
function sortUnitStats(stats: CombinedUnitStats[], config: SortConfig): CombinedUnitStats[] {
  const sorted = [...stats].sort((a, b) => {
    let comparison = 0;
    
    switch (config.field) {
      case 'unit':
        comparison = compareUnitsNatural(a.unit, b.unit);
        break;
      
      case 'lastActivity':
        // Null dates sort last in descending, first in ascending
        if (!a.lastActivity && !b.lastActivity) comparison = 0;
        else if (!a.lastActivity) comparison = 1; // a has no date, goes last
        else if (!b.lastActivity) comparison = -1; // b has no date, goes last
        else comparison = a.lastActivity.getTime() - b.lastActivity.getTime();
        break;
      
      case 'totalMentions':
        const totalA = a.filingsCount + a.hpdCount + a.threeOneOneCount + a.dobViolationsCount + a.ecbViolationsCount + a.permitsCount;
        const totalB = b.filingsCount + b.hpdCount + b.threeOneOneCount + b.dobViolationsCount + b.ecbViolationsCount + b.permitsCount;
        comparison = totalA - totalB;
        break;
    }
    
    // Apply direction
    return config.direction === 'desc' ? -comparison : comparison;
  });
  
  return sorted;
}

interface UnitInsightsCardProps {
  buildingBbl: string;
  bin?: string;
  hpdViolations: HPDViolationRecord[];
  hpdComplaints: HPDComplaintRecord[];
  serviceRequests: ServiceRequestRecord[];
  salesUnits: UnitRosterEntry[];
  dobFilingsUnits: UnitFromFilings[];
  dobFilings: JobFilingRecord[];
  dobViolations: ViolationRecord[];
  ecbViolations: ECBRecord[];
  dobPermits: PermitRecord[];
  selectedUnit: string | null;
  onUnitSelect: (unit: string) => void;
  onClearUnitFilter?: () => void;
  // Granular loading states for progressive display
  loadingStates?: {
    filings: boolean;
    permits: boolean;
    hpd: boolean;
    threeOneOne: boolean;
    violations: boolean;
    ecb: boolean;
  };
  /** @deprecated Use loadingStates instead */
  loading?: boolean;
  rosterError?: string | null;
  salesWarning?: string | null;
  filingsWarning?: string | null;
  dobNowUrl?: string | null;
  fallbackMode?: boolean;
}

// Note: ViolationMentionRef, PermitMentionRef, and CombinedUnitStats are imported from useUnitMentions

/**
 * Scanning status row - shows progress instead of skeleton
 */
function ScanningStatusRow({ 
  progress, 
  isPaused,
  isCached,
  onStop, 
  onRefresh 
}: { 
  progress: ScanProgress;
  isPaused: boolean;
  isCached: boolean;
  onStop: () => void;
  onRefresh: () => void;
}) {
  const elapsedSec = Math.floor(progress.elapsedMs / 1000);
  
  if (isCached) {
    return (
      <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="h-4 w-4" />
          <span>Loaded from cache</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} className="h-7 text-xs gap-1">
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>
    );
  }
  
  if (isPaused) {
    return (
      <div className="flex items-center justify-between p-3 bg-warning/10 rounded-lg border border-border">
        <div className="flex items-center gap-2 text-sm">
          <Pause className="h-4 w-4 text-warning" />
          <span className="text-warning">Scanning paused</span>
          <span className="text-muted-foreground">— partial results shown</span>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} className="h-7 text-xs gap-1">
          <RefreshCw className="h-3 w-3" />
          Resume
        </Button>
      </div>
    );
  }
  
  if (progress.stage === 'complete') {
    return null;
  }
  
  return (
    <div className="flex items-center justify-between p-3 bg-accent/30 rounded-lg border border-border">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 text-primary animate-spin" />
        <div className="text-sm">
          <span className="font-medium text-foreground">{progress.stageLabel}</span>
          {progress.total > 0 && (
            <span className="text-muted-foreground ml-2">
              {progress.scanned}/{progress.total} records
            </span>
          )}
          {elapsedSec > 5 && (
            <span className="text-muted-foreground ml-2">({elapsedSec}s)</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground hidden sm:inline">
          Large buildings may take 30–60s
        </span>
        <Button variant="ghost" size="sm" onClick={onStop} className="h-7 text-xs">
          Stop
        </Button>
      </div>
    </div>
  );
}
/**
 * Get confidence display info from a CombinedUnitStats entry.
 * Uses the new overallConfidence field calculated from extraction results.
 */
function getConfidenceLevel(stat: CombinedUnitStats): { level: UnitConfidence; dots: string; title: string } {
  const level = stat.overallConfidence;
  const details = stat.confidenceDetails || '';
  
  if (level === 'high') {
    return { level: 'high', dots: '●●●', title: `High confidence: ${details}` };
  }
  if (level === 'medium') {
    return { level: 'medium', dots: '●●○', title: `Medium confidence: ${details}` };
  }
  return { level: 'low', dots: '●○○', title: `Low confidence: ${details}` };
}

// Evidence record types for the drawer
interface EvidenceRecord {
  source: 'hpd' | '311' | 'sales' | 'filings';
  id: string;
  date: string | null;
  description: string | null;
  snippet?: string | null;
  status?: string | null;
}

function combineUnitStats(
  hpdViolationStats: UnitStats[],
  hpdComplaintStats: UnitStats[],
  threeOneOneStats: UnitStats[],
  salesUnits: UnitRosterEntry[],
  dobFilingsUnits: UnitFromFilings[],
  hpdViolations: HPDViolationRecord[],
  hpdComplaints: HPDComplaintRecord[],
  serviceRequests: ServiceRequestRecord[],
  dobViolations: ViolationRecord[],
  ecbViolations: ECBRecord[],
  dobPermits: PermitRecord[]
): CombinedUnitStats[] {
  const unitMap = new Map<string, CombinedUnitStats>();

  // Helper to get or create unit entry
  const getOrCreate = (unit: string): CombinedUnitStats => {
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
  };

  // Combine HPD violations and complaints
  const hpdStats = new Map<string, { count: number; lastActivity: Date | null }>();
  
  for (const stat of hpdViolationStats) {
    const existing = hpdStats.get(stat.unit) || { count: 0, lastActivity: null };
    existing.count += stat.count;
    if (stat.lastActivity && (!existing.lastActivity || stat.lastActivity > existing.lastActivity)) {
      existing.lastActivity = stat.lastActivity;
    }
    hpdStats.set(stat.unit, existing);
  }
  
  for (const stat of hpdComplaintStats) {
    const existing = hpdStats.get(stat.unit) || { count: 0, lastActivity: null };
    existing.count += stat.count;
    if (stat.lastActivity && (!existing.lastActivity || stat.lastActivity > existing.lastActivity)) {
      existing.lastActivity = stat.lastActivity;
    }
    hpdStats.set(stat.unit, existing);
  }

  // Process HPD stats with source references
  for (const [unit, data] of hpdStats.entries()) {
    const entry = getOrCreate(unit);
    entry.hpdCount = data.count;
    entry.totalCount += data.count;
    if (data.lastActivity && (!entry.lastActivity || data.lastActivity > entry.lastActivity)) {
      entry.lastActivity = data.lastActivity;
    }
  }

  // Add HPD source references
  for (const record of hpdViolations) {
    const unit = extractUnitFromRecord(record.raw);
    if (unit && unitMap.has(unit)) {
      const entry = unitMap.get(unit)!;
      // Add first few references only to avoid clutter
      if (entry.sourceRefs.filter(r => r.type === 'hpd').length < 3) {
        entry.sourceRefs.push({
          type: 'hpd',
          id: record.recordId,
          label: `HPD Violation #${record.recordId}`,
        });
      }
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
  }

  // Add 311 stats with source references
  for (const stat of threeOneOneStats) {
    const entry = getOrCreate(stat.unit);
    entry.threeOneOneCount = stat.count;
    entry.totalCount += stat.count;
    if (stat.lastActivity && (!entry.lastActivity || stat.lastActivity > entry.lastActivity)) {
      entry.lastActivity = stat.lastActivity;
    }
  }

  // Add 311 source references
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
  }

  // Add Rolling Sales stats (only count, no source refs since they don't have traceable IDs)
  for (const salesEntry of salesUnits) {
    const entry = getOrCreate(salesEntry.unit);
    entry.salesCount = salesEntry.count;
    entry.totalCount += salesEntry.count;
    const lastSeenDate = salesEntry.lastSeen ? new Date(salesEntry.lastSeen) : null;
    if (lastSeenDate && !isNaN(lastSeenDate.getTime()) && 
        (!entry.lastActivity || lastSeenDate > entry.lastActivity)) {
      entry.lastActivity = lastSeenDate;
    }
  }

  // Add DOB Filings stats with source references
  for (const filingsEntry of dobFilingsUnits) {
    const entry = getOrCreate(filingsEntry.unit);
    entry.filingsCount = filingsEntry.count;
    entry.totalCount += filingsEntry.count;
    entry.filingRefs = filingsEntry.filings;
    const lastSeenDate = filingsEntry.lastSeen ? new Date(filingsEntry.lastSeen) : null;
    if (lastSeenDate && !isNaN(lastSeenDate.getTime()) && 
        (!entry.lastActivity || lastSeenDate > entry.lastActivity)) {
      entry.lastActivity = lastSeenDate;
    }
    // Add DOB source references
    for (const filing of filingsEntry.filings.slice(0, 3)) {
      entry.sourceRefs.push({
        type: 'dob',
        id: filing.jobNumber,
        label: `Job #${filing.jobNumber}`,
      });
    }
  }

  // Process DOB Violations that mention units
  for (const record of dobViolations) {
    const extraction = extractUnitFromRecordWithTrace(record.raw);
    if (extraction) {
      const unit = extraction.normalizedUnit;
      const entry = getOrCreate(unit);
      entry.dobViolationsCount += 1;
      entry.totalCount += 1;
      
      // Update last activity
      if (record.issueDate) {
        const issueDate = new Date(record.issueDate);
        if (!isNaN(issueDate.getTime()) && (!entry.lastActivity || issueDate > entry.lastActivity)) {
          entry.lastActivity = issueDate;
        }
      }
      
      // Add source reference (limit to 5)
      if (entry.sourceRefs.filter(r => r.type === 'dob-violation').length < 5) {
        entry.sourceRefs.push({
          type: 'dob-violation',
          id: record.recordId,
          label: `DOB Vio #${record.recordId}`,
        });
      }
      
      // Add to violation refs for the new section with traceability
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
  }

  // Process ECB Violations that mention units
  for (const record of ecbViolations) {
    const extraction = extractUnitFromRecordWithTrace(record.raw);
    if (extraction) {
      const unit = extraction.normalizedUnit;
      const entry = getOrCreate(unit);
      entry.ecbViolationsCount += 1;
      entry.totalCount += 1;
      
      // Update last activity
      if (record.issueDate) {
        const issueDate = new Date(record.issueDate);
        if (!isNaN(issueDate.getTime()) && (!entry.lastActivity || issueDate > entry.lastActivity)) {
          entry.lastActivity = issueDate;
        }
      }
      
      // Add source reference (limit to 5)
      if (entry.sourceRefs.filter(r => r.type === 'ecb').length < 5) {
        entry.sourceRefs.push({
          type: 'ecb',
          id: record.recordId,
          label: `ECB #${record.recordId}`,
        });
      }
      
      // Add to violation refs for the new section with traceability
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
  }

  // Process DOB Permits that mention units
  for (const record of dobPermits) {
    const extraction = extractUnitFromRecordWithTrace(record.raw);
    if (extraction) {
      const unit = extraction.normalizedUnit;
      const entry = getOrCreate(unit);
      entry.permitsCount += 1;
      entry.totalCount += 1;
      
      // Update last activity
      if (record.issueDate) {
        const issueDate = new Date(record.issueDate);
        if (!isNaN(issueDate.getTime()) && (!entry.lastActivity || issueDate > entry.lastActivity)) {
          entry.lastActivity = issueDate;
        }
      }
      
      // Add source reference (limit to 5)
      if (entry.sourceRefs.filter(r => r.type === 'permit').length < 5) {
        const permitId = record.jobNumber || record.recordId;
        entry.sourceRefs.push({
          type: 'permit',
          id: permitId,
          label: record.jobNumber ? `Job #${record.jobNumber}` : `Permit #${record.recordId}`,
        });
      }
      
      // Add to permit refs with traceability from extraction
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
  }

  // CRITICAL: Only include units that have at least one traceable source record
  // Sales data alone is NOT sufficient (it doesn't indicate complaints or filings)
  const filteredStats = Array.from(unitMap.values()).filter(stat => {
    // Must have at least one source reference (DOB filings, HPD, 311, DOB Violations, ECB, or Permits)
    const hasTraceableSource = stat.filingsCount > 0 || stat.hpdCount > 0 || stat.threeOneOneCount > 0 || stat.dobViolationsCount > 0 || stat.ecbViolationsCount > 0 || stat.permitsCount > 0;
    return hasTraceableSource;
  });

  // Calculate overall confidence for each unit based on extraction results
  for (const stat of filteredStats) {
    // Count high-confidence extractions from violations/permits
    const allRefs = [...stat.violationRefs, ...stat.permitRefs];
    const highCount = allRefs.filter(r => r.confidence === 'high').length;
    const mediumCount = allRefs.filter(r => r.confidence === 'medium').length;
    
    // Also consider source diversity
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

  // Sort by lastActivity descending (most recent first), then by total count
  return filteredStats.sort((a, b) => {
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

function formatDate(date: Date | null): string {
  if (!date) return '-';
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

// Expandable source references component
interface SourceRef {
  type: 'dob' | 'hpd' | '311' | 'sales' | 'dob-violation' | 'ecb' | 'permit';
  id: string;
  label: string;
}

function ExpandableRefs({ refs }: { refs: SourceRef[] }) {
  const [expanded, setExpanded] = useState(false);
  
  if (refs.length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }
  
  const visibleRefs = expanded ? refs : refs.slice(0, 1);
  const hiddenCount = refs.length - 1;
  
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visibleRefs.map((ref, idx) => (
        <span 
          key={`${ref.type}-${ref.id}-${idx}`} 
          className="inline-block px-1.5 py-0.5 bg-muted rounded text-muted-foreground font-mono text-[11px]"
          title={ref.label}
        >
          {ref.label.length > 16 ? ref.label.slice(0, 16) + '…' : ref.label}
        </span>
      ))}
      {!expanded && hiddenCount > 0 && (
        <button 
          onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
          className="text-primary hover:underline text-[11px]"
        >
          +{hiddenCount} more
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button 
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
          className="text-muted-foreground hover:underline text-[11px]"
        >
          show less
        </button>
      )}
    </div>
  );
}

// Violations Mentioning Units Section Component
interface ViolationsMentioningUnitsSectionProps {
  combinedStats: CombinedUnitStats[];
  selectedUnit: string | null;
  onUnitSelect: (unit: string) => void;
}

function ViolationsMentioningUnitsSection({
  combinedStats,
  selectedUnit,
  onUnitSelect,
}: ViolationsMentioningUnitsSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  
  // Filter to only units with violation references
  const unitsWithViolations = combinedStats.filter(s => s.violationRefs.length > 0);
  
  if (unitsWithViolations.length === 0) return null;
  
  // Total counts
  const totalDobViolations = unitsWithViolations.reduce((sum, s) => sum + s.dobViolationsCount, 0);
  const totalEcbViolations = unitsWithViolations.reduce((sum, s) => sum + s.ecbViolationsCount, 0);
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-6">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-3 h-auto border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 rounded-lg">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-red-600 dark:text-red-400" />
            <span className="font-medium text-foreground">Violations Mentioning Units (Inferred)</span>
            <Badge variant="secondary" className="text-xs">
              {totalDobViolations + totalEcbViolations} violation{totalDobViolations + totalEcbViolations !== 1 ? 's' : ''}
            </Badge>
          </div>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        {/* Critical disclaimer */}
        <Alert className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
          <AlertDescription className="text-sm text-red-800 dark:text-red-200">
            <strong>Building-level violations.</strong> Violations are issued at the building level. 
            Unit references are inferred from violation text and do not imply unit-level enforcement or responsibility.
          </AlertDescription>
        </Alert>
        
        {/* Filter active indicator */}
        {selectedUnit && (
          <p className="text-xs text-muted-foreground px-1">
            Showing building violations that mention: <strong>{selectedUnit}</strong>
          </p>
        )}
        
        {/* Unit-by-unit violation breakdown */}
        <div className="space-y-2">
          {unitsWithViolations
            .filter(stat => !selectedUnit || stat.unit === selectedUnit)
            .map(stat => (
              <div 
                key={stat.unit} 
                className={`border rounded-lg p-3 bg-card ${
                  selectedUnit === stat.unit ? 'border-primary ring-1 ring-primary/20' : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      {stat.unit}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {stat.violationRefs.length} violation{stat.violationRefs.length !== 1 ? 's' : ''} mentioning this unit
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={selectedUnit === stat.unit ? 'secondary' : 'outline'}
                    onClick={() => onUnitSelect(stat.unit)}
                    className="h-6 px-2 text-xs"
                  >
                    {selectedUnit === stat.unit ? 'Viewing' : 'Filter'}
                  </Button>
                </div>
                
                {/* Violation pills */}
                <div className="flex flex-wrap gap-1.5">
                  {stat.violationRefs.slice(0, 8).map((vio, idx) => (
                    <TooltipProvider key={`${vio.type}-${vio.id}-${idx}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span 
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono cursor-help ${
                              vio.type === 'dob-violation' 
                                ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' 
                                : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                            }`}
                          >
                            {vio.type === 'dob-violation' ? 'DOB' : 'ECB'} #{vio.id.length > 10 ? vio.id.slice(-10) : vio.id}
                            {vio.status === 'open' && (
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Open" />
                            )}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <div className="text-xs space-y-1">
                            <p><strong>{vio.label}</strong></p>
                            <p>Status: {vio.status}</p>
                            {vio.issueDate && <p>Issued: {vio.issueDate}</p>}
                            {vio.sourceField && (
                              <p className="text-muted-foreground">
                                Found in: <code className="bg-muted px-1 py-0.5 rounded text-[10px]">{vio.sourceField}</code>
                              </p>
                            )}
                            {vio.snippet && (
                              <p className="bg-yellow-100 dark:bg-yellow-900/30 px-1 py-0.5 rounded italic">
                                {vio.snippet}
                              </p>
                            )}
                            {!vio.snippet && vio.description && <p className="line-clamp-2">{vio.description}</p>}
                            <p className="text-muted-foreground italic">Unit mentioned in record text</p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                  {stat.violationRefs.length > 8 && (
                    <span className="text-xs text-muted-foreground px-1">
                      +{stat.violationRefs.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Permits Mentioning Units Section Component
interface PermitsMentioningUnitsSectionProps {
  combinedStats: CombinedUnitStats[];
  selectedUnit: string | null;
  onUnitSelect: (unit: string) => void;
  dobNowUrl?: string | null;
}

function PermitsMentioningUnitsSection({
  combinedStats,
  selectedUnit,
  onUnitSelect,
  dobNowUrl,
}: PermitsMentioningUnitsSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  
  // Filter to only units with permit references
  const unitsWithPermits = combinedStats.filter(s => s.permitRefs.length > 0);
  
  if (unitsWithPermits.length === 0) return null;
  
  // Total counts
  const totalPermits = unitsWithPermits.reduce((sum, s) => sum + s.permitsCount, 0);
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-6">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-3 h-auto border border-border bg-accent/30 rounded-lg">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span className="font-medium text-foreground">Permits/Job Filings Mentioning Units (Inferred)</span>
            <Badge variant="secondary" className="text-xs">
              {totalPermits} permit{totalPermits !== 1 ? 's' : ''}
            </Badge>
          </div>
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        {/* Critical disclaimer */}
        <Alert className="elk-info-box">
          <Info className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm text-muted-foreground">
            <strong className="text-foreground">Building-level permits.</strong> DOB permits and job filings are issued at the building level. 
            Unit references are inferred from filing text and do not imply unit-level issuance or enforcement.
          </AlertDescription>
        </Alert>
        
        {/* Filter active indicator */}
        {selectedUnit && (
          <p className="text-xs text-muted-foreground px-1">
            Showing building permits/job filings that mention: <strong>{selectedUnit}</strong>
          </p>
        )}
        
        {/* Unit-by-unit permit breakdown */}
        <div className="space-y-2">
          {unitsWithPermits
            .filter(stat => !selectedUnit || stat.unit === selectedUnit)
            .map(stat => (
              <div 
                key={stat.unit} 
                className={`border rounded-lg p-3 bg-card ${
                  selectedUnit === stat.unit ? 'border-primary ring-1 ring-primary/20' : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      {stat.unit}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {stat.permitRefs.length} permit{stat.permitRefs.length !== 1 ? 's' : ''} mentioning this unit
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={selectedUnit === stat.unit ? 'secondary' : 'outline'}
                    onClick={() => onUnitSelect(stat.unit)}
                    className="h-6 px-2 text-xs"
                  >
                    {selectedUnit === stat.unit ? 'Viewing' : 'Filter'}
                  </Button>
                </div>
                
                {/* Permit pills */}
                <div className="flex flex-wrap gap-1.5">
                  {stat.permitRefs.slice(0, 8).map((permit, idx) => (
                    <TooltipProvider key={`${permit.type}-${permit.id}-${idx}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span 
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono cursor-help bg-accent text-accent-foreground"
                          >
                            {permit.jobNumber ? `Job #${permit.jobNumber.slice(-10)}` : `Permit #${permit.id.slice(-8)}`}
                            {permit.status === 'open' && (
                              <span className="w-1.5 h-1.5 rounded-full bg-success" title="Open/Active" />
                            )}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <div className="text-xs space-y-1">
                            <p><strong>{permit.label}</strong></p>
                            <p>Status: {permit.status}</p>
                            {permit.issueDate && <p>Issued: {permit.issueDate}</p>}
                            {permit.sourceField && (
                              <p className="text-muted-foreground">
                                Found in: <code className="bg-muted px-1 py-0.5 rounded text-[10px]">{permit.sourceField}</code>
                              </p>
                            )}
                            {permit.snippet && (
                              <p className="bg-yellow-100 dark:bg-yellow-900/30 px-1 py-0.5 rounded italic">
                                {permit.snippet}
                              </p>
                            )}
                            {!permit.snippet && permit.description && (
                              <p className="line-clamp-2">{permit.description}</p>
                            )}
                            <p className="text-muted-foreground italic">Unit mentioned in filing text</p>
                            {dobNowUrl && (
                              <a 
                                href={dobNowUrl} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-primary hover:underline flex items-center gap-1 mt-1"
                              >
                                View in DOB NOW <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                  {stat.permitRefs.length > 8 && (
                    <span className="text-xs text-muted-foreground px-1">
                      +{stat.permitRefs.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface EvidenceDrawerProps {
  open: boolean;
  onClose: () => void;
  unit: string;
  stats: CombinedUnitStats;
  hpdViolations: HPDViolationRecord[];
  hpdComplaints: HPDComplaintRecord[];
  serviceRequests: ServiceRequestRecord[];
  dobNowUrl?: string | null;
}

function EvidenceDrawer({
  open,
  onClose,
  unit,
  stats,
  hpdViolations,
  hpdComplaints,
  serviceRequests,
  dobNowUrl,
}: EvidenceDrawerProps) {
  const [hpdOpen, setHpdOpen] = useState(true);
  const [threeOneOneOpen, setThreeOneOneOpen] = useState(true);
  const [filingsOpen, setFilingsOpen] = useState(true);

  // Filter records matching this unit
  const matchingHpdViolations = useMemo(() => {
    return hpdViolations.filter(r => extractUnitFromRecord(r.raw) === unit);
  }, [hpdViolations, unit]);

  const matchingHpdComplaints = useMemo(() => {
    return hpdComplaints.filter(r => extractUnitFromRecord(r.raw) === unit);
  }, [hpdComplaints, unit]);

  const matching311 = useMemo(() => {
    return serviceRequests.filter(r => extractUnitFromRecord(r.raw) === unit);
  }, [serviceRequests, unit]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Badge className="bg-primary text-primary-foreground">Mentioned Unit: {unit}</Badge>
            <span className="text-muted-foreground font-normal text-sm">(Inferred from city records)</span>
          </DialogTitle>
          <DialogDescription>
            Records where this unit identifier appears in the text or metadata. 
            A "Mentioned Unit" means the unit appears in city records—it does not imply unit-level enforcement, responsibility, or issuance.
          </DialogDescription>
        </DialogHeader>

        {/* Warning banner - reinforced messaging */}
        <Alert className="elk-info-box border-warning/30">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertDescription className="text-sm text-muted-foreground">
            <strong className="text-foreground">Building-level records only.</strong> These records are issued at the building level. 
            Unit mentions are extracted from text fields and do not indicate unit-specific enforcement or legal responsibility.
          </AlertDescription>
        </Alert>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {/* DOB Filings */}
            {stats.filingRefs.length > 0 && (
              <Collapsible open={filingsOpen} onOpenChange={setFilingsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-3 h-auto">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="font-medium">DOB Job Filings</span>
                      <Badge variant="secondary">{stats.filingRefs.length}</Badge>
                    </div>
                    {filingsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-6 space-y-2">
                  {stats.filingRefs.map((filing, idx) => (
                    <div key={idx} className="border rounded-lg p-3 text-sm bg-muted/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-medium">{filing.jobNumber}</span>
                        {filing.status && (
                          <Badge variant="outline" className="text-xs">{filing.status}</Badge>
                        )}
                      </div>
                      {filing.jobType && (
                        <p className="text-muted-foreground text-xs mb-1">Type: {filing.jobType}</p>
                      )}
                      {filing.modifiedDate && (
                        <p className="text-muted-foreground text-xs mb-1">Date: {filing.modifiedDate}</p>
                      )}
                      {filing.snippet && (
                        <p className="text-xs italic bg-yellow-100 dark:bg-yellow-900/30 px-2 py-1 rounded mt-2">
                          "{filing.snippet}"
                        </p>
                      )}
                    </div>
                  ))}
                  {dobNowUrl && (
                    <a 
                      href={dobNowUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                    >
                      Open in DOB NOW <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* HPD Records */}
            {(matchingHpdViolations.length > 0 || matchingHpdComplaints.length > 0) && (
              <Collapsible open={hpdOpen} onOpenChange={setHpdOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-3 h-auto">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-orange-600" />
                      <span className="font-medium">HPD Records</span>
                      <Badge variant="secondary">{matchingHpdViolations.length + matchingHpdComplaints.length}</Badge>
                    </div>
                    {hpdOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-6 space-y-2">
                  {matchingHpdViolations.map((record, idx) => (
                    <div key={`vio-${idx}`} className="border rounded-lg p-3 text-sm bg-muted/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-medium">{record.recordId}</span>
                        <Badge variant={record.status === 'open' ? 'destructive' : 'secondary'} className="text-xs">
                          {record.status}
                        </Badge>
                      </div>
                      {record.category && (
                        <p className="text-muted-foreground text-xs mb-1">{record.category}</p>
                      )}
                      {record.description && (
                        <p className="text-xs">{record.description}</p>
                      )}
                      {record.issueDate && (
                        <p className="text-muted-foreground text-xs mt-1">Date: {record.issueDate}</p>
                      )}
                    </div>
                  ))}
                  {matchingHpdComplaints.map((record, idx) => (
                    <div key={`comp-${idx}`} className="border rounded-lg p-3 text-sm bg-muted/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-medium">{record.recordId}</span>
                        <Badge variant={record.status === 'open' ? 'destructive' : 'secondary'} className="text-xs">
                          {record.status}
                        </Badge>
                      </div>
                      {record.category && (
                        <p className="text-muted-foreground text-xs mb-1">{record.category}</p>
                      )}
                      {record.description && (
                        <p className="text-xs">{record.description}</p>
                      )}
                      {record.issueDate && (
                        <p className="text-muted-foreground text-xs mt-1">Date: {record.issueDate}</p>
                      )}
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* 311 Records */}
            {matching311.length > 0 && (
              <Collapsible open={threeOneOneOpen} onOpenChange={setThreeOneOneOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-3 h-auto">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-green-600" />
                      <span className="font-medium">311 Requests</span>
                      <Badge variant="secondary">{matching311.length}</Badge>
                    </div>
                    {threeOneOneOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-6 space-y-2">
                  {matching311.map((record, idx) => (
                    <div key={idx} className="border rounded-lg p-3 text-sm bg-muted/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-medium">{record.recordId}</span>
                        <Badge variant={record.status === 'open' ? 'destructive' : 'secondary'} className="text-xs">
                          {record.status}
                        </Badge>
                      </div>
                      {record.category && (
                        <p className="text-muted-foreground text-xs mb-1">{record.category}</p>
                      )}
                      {record.description && (
                        <p className="text-xs">{record.description}</p>
                      )}
                      {record.issueDate && (
                        <p className="text-muted-foreground text-xs mt-1">Date: {record.issueDate}</p>
                      )}
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Empty state within drawer */}
            {stats.filingRefs.length === 0 && 
             matchingHpdViolations.length === 0 && 
             matchingHpdComplaints.length === 0 && 
             matching311.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p>No detailed evidence available for this unit.</p>
                <p className="text-sm mt-1">This unit was found in sales records only.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function UnitInsightsCard({
  buildingBbl,
  bin,
  hpdViolations,
  hpdComplaints,
  serviceRequests,
  salesUnits,
  dobFilingsUnits,
  dobFilings,
  dobViolations,
  ecbViolations,
  dobPermits,
  selectedUnit,
  onUnitSelect,
  onClearUnitFilter,
  loadingStates,
  loading = false,
  salesWarning,
  filingsWarning,
  dobNowUrl,
  fallbackMode,
}: UnitInsightsCardProps) {
  const [evidenceUnit, setEvidenceUnit] = useState<string | null>(null);
  const [evidenceStats, setEvidenceStats] = useState<CombinedUnitStats | null>(null);
  
  // Sorting state - default to Last Activity descending
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'lastActivity',
    direction: 'desc'
  });

  // Use the new progressive loading hook
  // Map the prop interface to the hook's expected interface
  const hookLoadingStates = loadingStates 
    ? {
        filingsLoading: loadingStates.filings,
        permitsLoading: loadingStates.permits,
        hpdLoading: loadingStates.hpd,
        threeOneOneLoading: loadingStates.threeOneOne,
        violationsLoading: loadingStates.violations,
        ecbLoading: loadingStates.ecb,
      }
    : {
        filingsLoading: loading,
        permitsLoading: loading,
        hpdLoading: loading,
        threeOneOneLoading: loading,
        violationsLoading: loading,
        ecbLoading: loading,
      };
  
  const { 
    stats: combinedStats, 
    progress, 
    isScanning, 
    isPaused, 
    isCached,
    allLoadingComplete,
    totalSourceRecords,
    debugStats,
    stopScanning, 
    refreshData 
  } = useUnitMentions(
    buildingBbl,
    {
      dobFilingsUnits,
      salesUnits,
      dobPermits,
      hpdViolations,
      hpdComplaints,
      serviceRequests,
      dobViolations,
      ecbViolations,
    },
    hookLoadingStates
  );

  // Sorted stats based on current sort config
  const sortedStats = useMemo(() => {
    return sortUnitStats(combinedStats, sortConfig);
  }, [combinedStats, sortConfig]);

  const hasData = combinedStats.length > 0;
  const hasFilingsData = dobFilingsUnits.length > 0;
  // Show scanning status only when actively scanning, not when all loading is done
  const showScanningStatus = (isScanning && !allLoadingComplete) || isPaused || isCached;
  // Determine the empty state reason
  const emptyStateReason = useMemo(() => {
    if (!allLoadingComplete) return null; // Still loading
    if (hasData) return null; // Has data
    if (totalSourceRecords === 0) return 'no_records';
    return 'no_units_extracted';
  }, [allLoadingComplete, hasData, totalSourceRecords]);

  const handleViewEvidence = (stat: CombinedUnitStats) => {
    setEvidenceUnit(stat.unit);
    setEvidenceStats(stat);
  };

  // Toggle sort for a field
  const handleSort = useCallback((field: SortField) => {
    setSortConfig(prev => {
      if (prev.field === field) {
        // Toggle direction
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      // New field - use sensible default direction
      const defaultDirection: SortDirection = field === 'unit' ? 'asc' : 'desc';
      return { field, direction: defaultDirection };
    });
  }, []);

  // Get sort icon for a field
  const getSortIcon = (field: SortField) => {
    if (sortConfig.field !== field) {
      return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
    }
    return sortConfig.direction === 'asc' 
      ? <ArrowUp className="h-3.5 w-3.5" />
      : <ArrowDown className="h-3.5 w-3.5" />;
  };

  return (
    <>
      <Card className="elk-highlight-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <TooltipProvider>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Mentioned Units</CardTitle>
                {isScanning && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>A "Mentioned Unit" means the unit identifier appears in the text or metadata of a city record. It does not imply unit-level enforcement, responsibility, or issuance.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
            {hasData && (
              <Badge variant="secondary" className="text-xs">
                {combinedStats.length} unit{combinedStats.length !== 1 ? 's' : ''} mentioned
              </Badge>
            )}
          </div>
          {/* CRITICAL DISCLAIMER - Prominent placement */}
          <div className="mt-2 p-3 bg-muted/50 border border-border rounded-md">
            <p className="text-sm text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Important:</strong> A "Mentioned Unit" means the unit identifier appears in the text or metadata of a city record. 
              It does not imply unit-level enforcement, responsibility, or issuance. All NYC co-op records are issued at the building level.
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Active filter banner */}
          {selectedUnit && (
            <Alert className="border-primary/30 bg-primary/5">
              <Info className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm flex items-center justify-between">
                <span>
                  <strong>Filtering by: {selectedUnit}</strong> — Building totals unchanged. Showing records that mention this unit.
                </span>
                {onClearUnitFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearUnitFilter}
                    className="h-7 px-2 text-xs ml-2"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear unit filter
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Info banner */}
          <Alert className="elk-info-box">
            <Info className="h-4 w-4 text-primary" />
            <AlertDescription className="text-sm text-muted-foreground">
              Mentioned units are inferred only when city records explicitly reference an apartment or unit number (e.g., "APT 2G", "Unit PH").
              {fallbackMode && (
                <span className="block mt-1 text-amber-600 dark:text-amber-400">
                  Note: DOB job filings API unavailable.{' '}
                  {dobNowUrl && (
                    <a href={dobNowUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-1">
                      Open in DOB NOW <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </span>
              )}
              {salesWarning === 'rolling_sales_unavailable' && !fallbackMode && (
                <span className="block mt-1 text-amber-600 dark:text-amber-400">
                  Note: Rolling Sales data is currently unavailable.
                </span>
              )}
            </AlertDescription>
          </Alert>

          {/* DEV-only diagnostics panel */}
          <UnitExtractionDiagnostics
            hpdViolations={hpdViolations}
            hpdComplaints={hpdComplaints}
            serviceRequests={serviceRequests}
            dobPermits={dobPermits}
            dobViolations={dobViolations}
            ecbViolations={ecbViolations}
            dobFilingsUnits={dobFilingsUnits}
            salesUnits={salesUnits}
          />

          {/* Empty State - now more robust */}
          {!hasData && emptyStateReason && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-foreground font-medium mb-1">No mentioned units found</p>
              <p className="text-sm text-muted-foreground max-w-md">
                {emptyStateReason === 'no_records' ? (
                  <>No source records scanned for this building. Data may still be loading or unavailable.</>
                ) : (
                  <>
                    Scanned {totalSourceRecords} record{totalSourceRecords !== 1 ? 's' : ''} across sources; extracted 0 unit mentions.
                    All records are building-wide with no explicit apartment mentions.
                  </>
                )}
              </p>
              {/* DEV-only diagnostic info */}
              {import.meta.env.DEV && emptyStateReason === 'no_units_extracted' && (
                <div className="mt-4 p-3 bg-muted rounded-md text-left text-xs font-mono max-w-md">
                  <p className="font-semibold mb-2">DEV Diagnostics:</p>
                  <pre className="whitespace-pre-wrap text-muted-foreground">
                    {JSON.stringify(debugStats, null, 2)}
                  </pre>
                  <p className="mt-2 text-muted-foreground">
                    Add <code>?debug=1</code> to URL for more details in console.
                  </p>
                </div>
              )}
              {dobNowUrl && (
                <a 
                  href={dobNowUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="mt-4 text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  Check DOB NOW directly <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
          
          {/* Loading state when not complete and no data yet */}
          {!hasData && !emptyStateReason && !showScanningStatus && !allLoadingComplete && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Loading unit mentions...</p>
            </div>
          )}

          {/* Unit Stats Table */}
          {hasData && (
            <div className="space-y-2">
              {/* Table context explainer */}
              <p className="text-sm text-muted-foreground">
                Units appear here only when explicitly mentioned in DOB filings, HPD complaints, or 311 requests tied to this building.
              </p>
              <div className="rounded-md border border-amber-200 dark:border-amber-800 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-amber-100/50 dark:bg-amber-900/30">
                    {/* Sortable: Mentioned Unit */}
                    <TableHead className="font-semibold">
                      <button
                        onClick={() => handleSort('unit')}
                        className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                        title="Sort by unit (natural order: 1, 1A, 2, 2B, ... PH, BSMT)"
                      >
                        Mentioned Unit
                        {getSortIcon('unit')}
                      </button>
                    </TableHead>
                    <TableHead className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center justify-center gap-1 cursor-help">
                              <FileText className="h-3.5 w-3.5" />
                              DOB
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Jobs mentioning unit</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    <TableHead className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center justify-center gap-1 cursor-help">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              HPD
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Complaints mentioning unit</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    <TableHead className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center justify-center gap-1 cursor-help">
                              <Phone className="h-3.5 w-3.5" />
                              311
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Requests mentioning unit</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    {/* NEW: Violations column (DOB + ECB combined) */}
                    <TableHead className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center justify-center gap-1 cursor-help">
                              <Shield className="h-3.5 w-3.5" />
                              Vio
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p>Building-level DOB &amp; ECB violations that mention this unit. These are building-issued records, not unit-specific enforcement.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    {/* NEW: Permits column */}
                    <TableHead className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center justify-center gap-1 cursor-help">
                              <FileText className="h-3.5 w-3.5" />
                              Prmt
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p>Building-level DOB permits that mention this unit. These are building-issued records, not unit-specific permits.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    {/* Sortable: Total Mentions */}
                    <TableHead className="text-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => handleSort('totalMentions')}
                              className="flex items-center justify-center gap-1 hover:text-foreground transition-colors"
                              title="Sort by total mentions (DOB + HPD + 311 + Violations + Permits)"
                            >
                              Total
                              {getSortIcon('totalMentions')}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p>Total mentions across all record types (DOB filings, HPD, 311, Violations, Permits). Click to sort.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    <TableHead className="text-center w-16">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">Conf.</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p>Confidence reflects how consistently this unit identifier appears across multiple records and sources for this building.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    <TableHead className="min-w-[120px]">Referenced In</TableHead>
                    {/* Sortable: Last Activity */}
                    <TableHead>
                      <button
                        onClick={() => handleSort('lastActivity')}
                        className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                        title="Sort by last activity date"
                      >
                        Last Activity
                        {getSortIcon('lastActivity')}
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedStats.map((stat) => (
                    <TableRow 
                      key={stat.unit}
                      className={`
                        cursor-pointer transition-colors
                        ${selectedUnit === stat.unit 
                          ? 'bg-amber-200/50 dark:bg-amber-800/30' 
                          : 'hover:bg-amber-100/50 dark:hover:bg-amber-900/20'
                        }
                      `}
                    >
                      <TableCell className="font-mono font-medium">
                        <div className="flex items-center gap-1.5">
                          {selectedUnit === stat.unit && (
                            <Badge className="bg-amber-600 text-white text-xs">Active</Badge>
                          )}
                          <span>{stat.unit}</span>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-[10px] text-muted-foreground italic cursor-help">
                                  as reported
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>Unit identifier appears exactly as written in city records and has not been normalized to an official unit roster.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {stat.filingsCount > 0 ? (
                          <Badge variant="outline" className="font-mono">
                            {stat.filingsCount}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {stat.hpdCount > 0 ? (
                          <Badge variant="outline" className="font-mono">
                            {stat.hpdCount}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {stat.threeOneOneCount > 0 ? (
                          <Badge variant="outline" className="font-mono">
                            {stat.threeOneOneCount}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      {/* Violations (DOB + ECB combined) */}
                      <TableCell className="text-center">
                        {(() => {
                          const violationsTotal = stat.dobViolationsCount + stat.ecbViolationsCount;
                          return violationsTotal > 0 ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="font-mono cursor-help text-destructive border-destructive/50">
                                    {violationsTotal}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs">
                                    {stat.dobViolationsCount > 0 && `${stat.dobViolationsCount} DOB violation${stat.dobViolationsCount !== 1 ? 's' : ''}`}
                                    {stat.dobViolationsCount > 0 && stat.ecbViolationsCount > 0 && ', '}
                                    {stat.ecbViolationsCount > 0 && `${stat.ecbViolationsCount} ECB violation${stat.ecbViolationsCount !== 1 ? 's' : ''}`}
                                    {' '}mention this unit. Building-issued, not unit-specific.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          );
                        })()}
                      </TableCell>
                      {/* Permits */}
                      <TableCell className="text-center">
                        {stat.permitsCount > 0 ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className="font-mono cursor-help">
                                  {stat.permitsCount}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p className="text-xs">
                                  {stat.permitsCount} permit{stat.permitsCount !== 1 ? 's' : ''} mention this unit. Building-issued, not unit-specific.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      {/* Total Mentions */}
                      <TableCell className="text-center">
                        {(() => {
                          const total = stat.filingsCount + stat.hpdCount + stat.threeOneOneCount + 
                            stat.dobViolationsCount + stat.ecbViolationsCount + stat.permitsCount;
                          return total > 0 ? (
                            <Badge variant="secondary" className="font-mono font-semibold">
                              {total}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          );
                        })()}
                      </TableCell>
                      {/* Confidence indicator */}
                      <TableCell className="text-center">
                        {(() => {
                          const conf = getConfidenceLevel(stat);
                          return (
                            <span 
                              className={`font-mono text-xs cursor-help ${
                                conf.level === 'high' ? 'text-green-600 dark:text-green-400' :
                                conf.level === 'medium' ? 'text-amber-600 dark:text-amber-400' :
                                'text-muted-foreground'
                              }`}
                              title={conf.title}
                            >
                              {conf.dots}
                            </span>
                          );
                        })()}
                      </TableCell>
                      {/* Referenced In - expandable */}
                      <TableCell className="text-xs">
                        <ExpandableRefs refs={stat.sourceRefs} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(stat.lastActivity)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleViewEvidence(stat)}
                              className="h-7 px-2 text-xs"
                              title="View evidence"
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant={selectedUnit === stat.unit ? 'secondary' : 'outline'}
                              onClick={() => onUnitSelect(stat.unit)}
                              className="h-7 px-3 text-xs"
                              title="Filter to records that mention this unit. Building totals remain unchanged."
                            >
                              {selectedUnit === stat.unit ? 'Viewing' : 'Filter records'}
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
              {/* Exclusion footnote */}
              <p className="text-xs text-muted-foreground mt-2">
                Units not listed were not explicitly referenced in available city records.
              </p>
            </div>
          )}

          {/* Violations Mentioning Units Section - Only show if there are violations that mention units */}
          {hasData && combinedStats.some(s => s.violationRefs.length > 0) && (
            <ViolationsMentioningUnitsSection
              combinedStats={combinedStats}
              selectedUnit={selectedUnit}
              onUnitSelect={onUnitSelect}
            />
          )}

          {/* Permits Mentioning Units Section - Only show if there are permits that mention units */}
          {hasData && combinedStats.some(s => s.permitRefs.length > 0) && (
            <PermitsMentioningUnitsSection
              combinedStats={combinedStats}
              selectedUnit={selectedUnit}
              onUnitSelect={onUnitSelect}
              dobNowUrl={dobNowUrl}
            />
          )}
        </CardContent>
      </Card>

      {/* Evidence Drawer */}
      {evidenceUnit && evidenceStats && (
        <EvidenceDrawer
          open={!!evidenceUnit}
          onClose={() => {
            setEvidenceUnit(null);
            setEvidenceStats(null);
          }}
          unit={evidenceUnit}
          stats={evidenceStats}
          hpdViolations={hpdViolations}
          hpdComplaints={hpdComplaints}
          serviceRequests={serviceRequests}
          dobNowUrl={dobNowUrl}
        />
      )}
    </>
  );
}
