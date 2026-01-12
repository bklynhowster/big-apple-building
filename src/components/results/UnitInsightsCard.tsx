import { useMemo, useState } from 'react';
import { Eye, Info, Users, AlertTriangle, Phone, ShoppingBag, FileText, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getUnitStats, UnitStats, extractUnitFromRecord } from '@/utils/unit';
import type { HPDComplaintRecord, HPDViolationRecord } from '@/hooks/useHPD';
import type { ServiceRequestRecord } from '@/hooks/use311';
import type { UnitRosterEntry } from '@/hooks/useCoopUnitRoster';
import type { UnitFromFilings, FilingReference, JobFilingRecord } from '@/hooks/useDobJobFilings';

interface UnitInsightsCardProps {
  buildingBbl: string;
  bin?: string;
  hpdViolations: HPDViolationRecord[];
  hpdComplaints: HPDComplaintRecord[];
  serviceRequests: ServiceRequestRecord[];
  salesUnits: UnitRosterEntry[];
  dobFilingsUnits: UnitFromFilings[];
  dobFilings: JobFilingRecord[];
  selectedUnit: string | null;
  onUnitSelect: (unit: string) => void;
  loading?: boolean;
  salesWarning?: string | null;
  filingsWarning?: string | null;
  dobNowUrl?: string | null;
  fallbackMode?: boolean;
}

interface CombinedUnitStats {
  unit: string;
  hpdCount: number;
  threeOneOneCount: number;
  salesCount: number;
  filingsCount: number;
  totalCount: number;
  lastActivity: Date | null;
  filingRefs: FilingReference[];
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
  dobFilingsUnits: UnitFromFilings[]
): CombinedUnitStats[] {
  const unitMap = new Map<string, CombinedUnitStats>();

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

  // Process HPD stats
  for (const [unit, data] of hpdStats.entries()) {
    unitMap.set(unit, {
      unit,
      hpdCount: data.count,
      threeOneOneCount: 0,
      salesCount: 0,
      filingsCount: 0,
      totalCount: data.count,
      lastActivity: data.lastActivity,
      filingRefs: [],
    });
  }

  // Add 311 stats
  for (const stat of threeOneOneStats) {
    const existing = unitMap.get(stat.unit);
    if (existing) {
      existing.threeOneOneCount = stat.count;
      existing.totalCount += stat.count;
      if (stat.lastActivity && (!existing.lastActivity || stat.lastActivity > existing.lastActivity)) {
        existing.lastActivity = stat.lastActivity;
      }
    } else {
      unitMap.set(stat.unit, {
        unit: stat.unit,
        hpdCount: 0,
        threeOneOneCount: stat.count,
        salesCount: 0,
        filingsCount: 0,
        totalCount: stat.count,
        lastActivity: stat.lastActivity,
        filingRefs: [],
      });
    }
  }

  // Add Rolling Sales stats
  for (const salesEntry of salesUnits) {
    const existing = unitMap.get(salesEntry.unit);
    const lastSeenDate = salesEntry.lastSeen ? new Date(salesEntry.lastSeen) : null;
    
    if (existing) {
      existing.salesCount = salesEntry.count;
      existing.totalCount += salesEntry.count;
      if (lastSeenDate && !isNaN(lastSeenDate.getTime()) && 
          (!existing.lastActivity || lastSeenDate > existing.lastActivity)) {
        existing.lastActivity = lastSeenDate;
      }
    } else {
      unitMap.set(salesEntry.unit, {
        unit: salesEntry.unit,
        hpdCount: 0,
        threeOneOneCount: 0,
        salesCount: salesEntry.count,
        filingsCount: 0,
        totalCount: salesEntry.count,
        lastActivity: lastSeenDate && !isNaN(lastSeenDate.getTime()) ? lastSeenDate : null,
        filingRefs: [],
      });
    }
  }

  // Add DOB Filings stats
  for (const filingsEntry of dobFilingsUnits) {
    const existing = unitMap.get(filingsEntry.unit);
    const lastSeenDate = filingsEntry.lastSeen ? new Date(filingsEntry.lastSeen) : null;
    
    if (existing) {
      existing.filingsCount = filingsEntry.count;
      existing.totalCount += filingsEntry.count;
      existing.filingRefs = filingsEntry.filings;
      if (lastSeenDate && !isNaN(lastSeenDate.getTime()) && 
          (!existing.lastActivity || lastSeenDate > existing.lastActivity)) {
        existing.lastActivity = lastSeenDate;
      }
    } else {
      unitMap.set(filingsEntry.unit, {
        unit: filingsEntry.unit,
        hpdCount: 0,
        threeOneOneCount: 0,
        salesCount: 0,
        filingsCount: filingsEntry.count,
        totalCount: filingsEntry.count,
        lastActivity: lastSeenDate && !isNaN(lastSeenDate.getTime()) ? lastSeenDate : null,
        filingRefs: filingsEntry.filings,
      });
    }
  }

  // Apply building consistency filter:
  // Only include units that appear in at least 2 records total OR appear in HPD/DOB/Sales at least once
  const filteredStats = Array.from(unitMap.values()).filter(stat => {
    return stat.hpdCount >= 1 || stat.salesCount >= 1 || stat.filingsCount >= 1 || stat.totalCount >= 2;
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

// Evidence Drawer Component
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
            <Badge className="bg-amber-600 text-white">Unit {unit}</Badge>
            <span className="text-muted-foreground font-normal text-sm">(Inferred)</span>
          </DialogTitle>
          <DialogDescription>
            Evidence from building-level records that explicitly mention this unit.
          </DialogDescription>
        </DialogHeader>

        {/* Warning banner */}
        <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
            These are building-level records with unit context inferred from text. 
            Confirm in DOB NOW where needed.
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
  selectedUnit,
  onUnitSelect,
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
    
    return combineUnitStats(hpdViolationStats, hpdComplaintStats, threeOneOneStats, salesUnits, dobFilingsUnits);
  }, [hpdViolations, hpdComplaints, serviceRequests, salesUnits, dobFilingsUnits]);

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
            <CardTitle className="text-lg">Unit Insights (Inferred from filings & complaints)</CardTitle>
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
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <CardTitle className="text-lg">Unit Insights (Inferred from filings & complaints)</CardTitle>
            </div>
            {hasData && (
              <Badge variant="secondary" className="text-xs">
                {combinedStats.length} unit{combinedStats.length !== 1 ? 's' : ''} referenced
              </Badge>
            )}
          </div>
          <CardDescription className="text-sm text-muted-foreground">
            Co-op records are issued at the building level. Unit context is inferred when city records explicitly mention an apartment/unit.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Info banner */}
          <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
            <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
              Units are inferred from DOB job filings, HPD complaints, 311 requests, and Rolling Sales data.
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
              <p className="text-foreground font-medium mb-1">No reliable unit references found</p>
              <p className="text-sm text-muted-foreground max-w-md">
                No reliable unit references found in DOB filings, HPD, 311, or Sales for this building.
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
            <div className="rounded-md border border-amber-200 dark:border-amber-800 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-amber-100/50 dark:bg-amber-900/30">
                    <TableHead className="font-semibold">Unit</TableHead>
                    <TableHead className="text-center">
                      <span className="flex items-center justify-center gap-1">
                        <FileText className="h-3.5 w-3.5" />
                        DOB
                      </span>
                    </TableHead>
                    <TableHead className="text-center">
                      <span className="flex items-center justify-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        HPD
                      </span>
                    </TableHead>
                    <TableHead className="text-center">
                      <span className="flex items-center justify-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        311
                      </span>
                    </TableHead>
                    <TableHead className="text-center">
                      <span className="flex items-center justify-center gap-1">
                        <ShoppingBag className="h-3.5 w-3.5" />
                        Sales
                      </span>
                    </TableHead>
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
                        {selectedUnit === stat.unit && (
                          <Badge className="mr-2 bg-amber-600 text-white text-xs">Active</Badge>
                        )}
                        {stat.unit}
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
                      <TableCell className="text-center">
                        {stat.salesCount > 0 ? (
                          <Badge variant="outline" className="font-mono">
                            {stat.salesCount}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(stat.lastActivity)}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
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
                        >
                          {selectedUnit === stat.unit ? 'Viewing' : 'Filter'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
