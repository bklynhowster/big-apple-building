import { useMemo } from 'react';
import { Eye, Info, Users, AlertTriangle, Phone } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getUnitStats, UnitStats } from '@/utils/unit';
import type { HPDComplaintRecord, HPDViolationRecord } from '@/hooks/useHPD';
import type { ServiceRequestRecord } from '@/hooks/use311';

interface UnitInsightsCardProps {
  buildingBbl: string;
  hpdViolations: HPDViolationRecord[];
  hpdComplaints: HPDComplaintRecord[];
  serviceRequests: ServiceRequestRecord[];
  selectedUnit: string | null;
  onUnitSelect: (unit: string) => void;
  loading?: boolean;
}

interface CombinedUnitStats {
  unit: string;
  hpdCount: number;
  threeOneOneCount: number;
  totalCount: number;
  lastActivity: Date | null;
}

function combineUnitStats(
  hpdViolationStats: UnitStats[],
  hpdComplaintStats: UnitStats[],
  threeOneOneStats: UnitStats[]
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
      totalCount: data.count,
      lastActivity: data.lastActivity,
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
        totalCount: stat.count,
        lastActivity: stat.lastActivity,
      });
    }
  }

  // Sort by total count descending
  return Array.from(unitMap.values()).sort((a, b) => {
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

export function UnitInsightsCard({
  buildingBbl,
  hpdViolations,
  hpdComplaints,
  serviceRequests,
  selectedUnit,
  onUnitSelect,
  loading = false,
}: UnitInsightsCardProps) {
  // Calculate unit stats from records
  const combinedStats = useMemo(() => {
    const hpdViolationStats = getUnitStats(hpdViolations.map(r => r.raw));
    const hpdComplaintStats = getUnitStats(hpdComplaints.map(r => r.raw));
    const threeOneOneStats = getUnitStats(serviceRequests.map(r => r.raw));
    
    return combineUnitStats(hpdViolationStats, hpdComplaintStats, threeOneOneStats);
  }, [hpdViolations, hpdComplaints, serviceRequests]);

  const hasData = combinedStats.length > 0;

  if (loading) {
    return (
      <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <CardTitle className="text-lg">Unit Insights (from city records)</CardTitle>
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
    <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <CardTitle className="text-lg">Unit Insights (from city records)</CardTitle>
          </div>
          {hasData && (
            <Badge variant="secondary" className="text-xs">
              {combinedStats.length} unit{combinedStats.length !== 1 ? 's' : ''} referenced
            </Badge>
          )}
        </div>
        <CardDescription className="text-sm text-muted-foreground">
          These are building-level records that explicitly mention a unit. 
          <span className="font-medium text-amber-700 dark:text-amber-300"> Unit references are inferred from HPD and 311 data.</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Info banner */}
        <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
          <Info className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Co-ops:</strong> NYC data is generally issued at the building level. 
            Unit Insights are inferred from records that explicitly mention an apartment/unit.
          </AlertDescription>
        </Alert>

        {/* Empty State */}
        {!hasData && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-foreground font-medium mb-1">No unit-referenced records found</p>
            <p className="text-sm text-muted-foreground max-w-md">
              No HPD or 311 records explicitly mention specific apartments. 
              All records are building-wide.
            </p>
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
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(stat.lastActivity)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={selectedUnit === stat.unit ? 'secondary' : 'outline'}
                        onClick={() => onUnitSelect(stat.unit)}
                        className="h-7 px-3 text-xs gap-1"
                      >
                        <Eye className="h-3 w-3" />
                        {selectedUnit === stat.unit ? 'Viewing' : 'View unit'}
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
  );
}
