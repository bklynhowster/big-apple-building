import { useMemo, useState } from 'react';
import { Eye, Info, Users, AlertTriangle, Phone, FileText, ExternalLink, ChevronDown, ChevronUp, X, Shield } from 'lucide-react';
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
import { getUnitStats, UnitStats, extractUnitFromRecord } from '@/utils/unit';
import type { HPDComplaintRecord, HPDViolationRecord } from '@/hooks/useHPD';
import type { ServiceRequestRecord } from '@/hooks/use311';
import type { UnitRosterEntry } from '@/hooks/useCoopUnitRoster';
import type { UnitFromFilings, FilingReference, JobFilingRecord } from '@/hooks/useDobJobFilings';
import type { ViolationRecord } from '@/hooks/useViolations';
import type { ECBRecord } from '@/hooks/useECB';
import type { PermitRecord } from '@/hooks/usePermits';

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
  loading?: boolean;
  rosterError?: string | null;
  salesWarning?: string | null;
  filingsWarning?: string | null;
  dobNowUrl?: string | null;
  fallbackMode?: boolean;
}

interface ViolationMentionRef {
  type: 'dob-violation' | 'ecb';
  id: string;
  label: string;
  status: string;
  issueDate: string | null;
  description: string | null;
}

interface PermitMentionRef {
  type: 'permit';
  id: string;
  jobNumber: string | null;
  label: string;
  status: string;
  issueDate: string | null;
  description: string | null;
  snippet: string | null;
}

interface CombinedUnitStats {
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
  // Provenance: source identifiers for traceability
  sourceRefs: {
    type: 'dob' | 'hpd' | '311' | 'sales' | 'dob-violation' | 'ecb' | 'permit';
    id: string;
    label: string;
  }[];
  // Violation-specific references for the new section
  violationRefs: ViolationMentionRef[];
  // Permit-specific references
  permitRefs: PermitMentionRef[];
}

/**
 * Calculate confidence level based on source diversity and count.
 * High: 2+ DOB filings
 * Medium: DOB + other source, or 2+ sources
 * Low: single source mention
 */
function getConfidenceLevel(stat: CombinedUnitStats): { level: 'high' | 'medium' | 'low'; dots: string; title: string } {
  const sourceTypes = [
    stat.filingsCount > 0,
    stat.hpdCount > 0,
    stat.threeOneOneCount > 0,
  ].filter(Boolean).length;
  
  if (stat.filingsCount >= 2) {
    return { level: 'high', dots: '●●●', title: 'High: Referenced by 2+ DOB filings' };
  }
  if (stat.filingsCount >= 1 && sourceTypes >= 2) {
    return { level: 'medium', dots: '●●○', title: 'Medium: DOB filing + other source' };
  }
  if (sourceTypes >= 2) {
    return { level: 'medium', dots: '●●○', title: 'Medium: Multiple source types' };
  }
  return { level: 'low', dots: '●○○', title: 'Low: Single source mention' };
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
    const unit = extractUnitFromRecord(record.raw);
    if (unit) {
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
      
      // Add to violation refs for the new section
      entry.violationRefs.push({
        type: 'dob-violation',
        id: record.recordId,
        label: `DOB Violation #${record.recordId}`,
        status: record.status,
        issueDate: record.issueDate,
        description: record.description,
      });
    }
  }

  // Process ECB Violations that mention units
  for (const record of ecbViolations) {
    const unit = extractUnitFromRecord(record.raw);
    if (unit) {
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
      
      // Add to violation refs for the new section
      entry.violationRefs.push({
        type: 'ecb',
        id: record.recordId,
        label: `ECB Violation #${record.recordId}`,
        status: record.status,
        issueDate: record.issueDate,
        description: record.description,
      });
    }
  }

  // Process DOB Permits that mention units
  for (const record of dobPermits) {
    const unit = extractUnitFromRecord(record.raw);
    if (unit) {
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
      
      // Extract snippet showing unit mention
      let snippet: string | null = null;
      const descText = record.description || '';
      if (descText) {
        const unitPattern = new RegExp(`(.{0,30})(APT\\.?|APARTMENT|UNIT|#)\\s*${unit}(.{0,30})`, 'i');
        const match = descText.match(unitPattern);
        if (match) {
          snippet = `...${match[1]}${match[2]} ${unit}${match[3]}...`.trim();
        }
      }
      
      // Add to permit refs
      entry.permitRefs.push({
        type: 'permit',
        id: record.recordId,
        jobNumber: record.jobNumber,
        label: record.jobNumber ? `Job #${record.jobNumber}` : `Permit #${record.recordId}`,
        status: record.status,
        issueDate: record.issueDate,
        description: record.description,
        snippet,
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
                            {vio.description && <p className="line-clamp-2">{vio.description}</p>}
                            <p className="text-muted-foreground italic">Mentions unit in record text</p>
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
        <Button variant="ghost" className="w-full justify-between p-3 h-auto border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
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
        <Alert className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Building-level permits.</strong> DOB permits and job filings are issued at the building level. 
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
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono cursor-help bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                          >
                            {permit.jobNumber ? `Job #${permit.jobNumber.slice(-10)}` : `Permit #${permit.id.slice(-8)}`}
                            {permit.status === 'open' && (
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Open/Active" />
                            )}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <div className="text-xs space-y-1">
                            <p><strong>{permit.label}</strong></p>
                            <p>Status: {permit.status}</p>
                            {permit.issueDate && <p>Issued: {permit.issueDate}</p>}
                            {permit.snippet && (
                              <p className="bg-yellow-100 dark:bg-yellow-900/30 px-1 py-0.5 rounded italic">
                                {permit.snippet}
                              </p>
                            )}
                            {permit.description && !permit.snippet && (
                              <p className="line-clamp-2">{permit.description}</p>
                            )}
                            <p className="text-muted-foreground italic">Mentions unit in filing text</p>
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
            <Badge className="bg-amber-600 text-white">Mentioned Unit: {unit}</Badge>
            <span className="text-muted-foreground font-normal text-sm">(Inferred from city records)</span>
          </DialogTitle>
          <DialogDescription>
            Records where this unit identifier appears in the text or metadata. 
            A "Mentioned Unit" means the unit appears in city records—it does not imply unit-level enforcement, responsibility, or issuance.
          </DialogDescription>
        </DialogHeader>

        {/* Warning banner - reinforced messaging */}
        <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Building-level records only.</strong> These records are issued at the building level. 
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
                      <FileText className="h-4 w-4 text-blue-600" />
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
  loading = false,
  salesWarning,
  filingsWarning,
  dobNowUrl,
  fallbackMode,
}: UnitInsightsCardProps) {
  const [evidenceUnit, setEvidenceUnit] = useState<string | null>(null);
  const [evidenceStats, setEvidenceStats] = useState<CombinedUnitStats | null>(null);

  // Calculate unit stats from records
  const combinedStats = useMemo(() => {
    const hpdViolationStats = getUnitStats(hpdViolations.map(r => r.raw));
    const hpdComplaintStats = getUnitStats(hpdComplaints.map(r => r.raw));
    const threeOneOneStats = getUnitStats(serviceRequests.map(r => r.raw));
    
    return combineUnitStats(
      hpdViolationStats, 
      hpdComplaintStats, 
      threeOneOneStats, 
      salesUnits, 
      dobFilingsUnits,
      hpdViolations,
      hpdComplaints,
      serviceRequests,
      dobViolations,
      ecbViolations,
      dobPermits
    );
  }, [hpdViolations, hpdComplaints, serviceRequests, salesUnits, dobFilingsUnits, dobViolations, ecbViolations, dobPermits]);

  const hasData = combinedStats.length > 0;
  const hasFilingsData = dobFilingsUnits.length > 0;

  const handleViewEvidence = (stat: CombinedUnitStats) => {
    setEvidenceUnit(stat.unit);
    setEvidenceStats(stat);
  };

  if (loading) {
    return (
      <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <CardTitle className="text-lg">Mentioned Units</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <TooltipProvider>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <CardTitle className="text-lg">Mentioned Units</CardTitle>
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
          <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
            <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
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

          {/* Empty State */}
          {!hasData && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-foreground font-medium mb-1">No mentioned units found</p>
              <p className="text-sm text-muted-foreground max-w-md">
                No city records (DOB filings, HPD complaints, 311 requests) explicitly mention an apartment or unit number for this building. 
                All records are building-wide.
              </p>
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
                    <TableHead className="font-semibold">Mentioned Unit</TableHead>
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
                    <TableHead>Last Activity</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {combinedStats.map((stat) => (
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
