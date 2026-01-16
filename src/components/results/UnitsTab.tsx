import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Building2, Home, Search, AlertCircle, Info, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCondoUnits, type CondoUnit } from '@/hooks/useCondoUnits';
import { useIsMobileViewport } from '@/hooks/useBreakpoint';
import { UnitCardMobile } from './UnitCardMobile';
import { 
  useCondoUnitTaxes, 
  type CondoUnitTaxSummary,
  formatUSDForTable,
  formatDate,
  formatLot,
  getPaymentStatusInfo,
  normalizeBbl,
  UNITS_PAGE_SIZE,
  LOAD_ALL_BATCH_DELAY_MS,
} from '@/features/taxes';
import { cn } from '@/lib/utils';

interface UnitsTabProps {
  bbl: string;
  buildingAddress?: string;
  borough?: string;
  bin?: string;
  isCoop?: boolean;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full max-w-sm" />
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

function boroughNameFromBbl(bbl: string): string {
  const borough = bbl.substring(0, 1);
  return (
    {
      '1': 'Manhattan',
      '2': 'Bronx',
      '3': 'Brooklyn',
      '4': 'Queens',
      '5': 'Staten Island',
    }[borough] || 'Unknown'
  );
}

export function UnitsTab({ 
  bbl, 
  buildingAddress, 
  borough: buildingBorough, 
  bin: buildingBin,
  isCoop = false,
}: UnitsTabProps) {
  const navigate = useNavigate();
  const isMobile = useIsMobileViewport();
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleUnitCount, setVisibleUnitCount] = useState(UNITS_PAGE_SIZE);
  const [loadingAll, setLoadingAll] = useState(false);
  const loadAllAbortRef = useRef(false);

  // Condo units hook
  const {
    loading: unitsLoading,
    loadingMore,
    error: unitsError,
    data: condoData,
    fetchFirstPage,
    fetchNextPage,
  } = useCondoUnits();

  // Tax data hook
  const {
    unitTaxes,
    batchLoading: taxBatchLoading,
    ensureLoaded,
    reset: resetTaxes,
  } = useCondoUnitTaxes();

  // Fetch condo units on mount
  useEffect(() => {
    if (bbl && !isCoop) {
      fetchFirstPage(bbl);
      resetTaxes();
      setVisibleUnitCount(UNITS_PAGE_SIZE);
      loadAllAbortRef.current = true; // Abort any ongoing load-all
    }
  }, [bbl, isCoop, fetchFirstPage, resetTaxes]);

  const units = condoData?.units || [];
  const totalUnits = condoData?.totalApprox || 0;
  const isCondo = condoData?.isCondo ?? false;
  const hasMorePages = units.length < totalUnits;

  // Filter units by search term
  const filteredUnits = useMemo(() => {
    if (!searchTerm.trim()) return units;
    const term = searchTerm.toLowerCase();
    return units.filter((unit) => {
      const label = (unit.unitLabel || '').toLowerCase();
      const lot = String(unit.lot || '').toLowerCase();
      return label.includes(term) || lot.includes(term);
    });
  }, [units, searchTerm]);

  // Displayed units (paginated)
  const displayedUnits = useMemo(() => {
    return filteredUnits.slice(0, visibleUnitCount);
  }, [filteredUnits, visibleUnitCount]);

  // Trigger tax fetch for displayed units
  useEffect(() => {
    if (displayedUnits.length === 0) return;
    
    const unitsToFetch = displayedUnits
      .filter((u) => u.unitBbl)
      .map((u) => ({ unitBbl: u.unitBbl, unitLabel: u.unitLabel }));
    
    if (unitsToFetch.length > 0) {
      ensureLoaded(unitsToFetch);
    }
  }, [displayedUnits, ensureLoaded]);

  // Handle load more
  const handleLoadMore = useCallback(() => {
    const nextCount = Math.min(visibleUnitCount + UNITS_PAGE_SIZE, filteredUnits.length);
    
    // Pre-fetch taxes for next batch immediately
    const nextBatch = filteredUnits.slice(visibleUnitCount, nextCount);
    const nextUnits = nextBatch
      .filter((u) => u.unitBbl)
      .map((u) => ({ unitBbl: u.unitBbl, unitLabel: u.unitLabel }));
    if (nextUnits.length > 0) {
      ensureLoaded(nextUnits);
    }
    
    setVisibleUnitCount(nextCount);
    
    // Also fetch more condo unit pages if needed
    if (nextCount >= units.length && hasMorePages) {
      fetchNextPage();
    }
  }, [visibleUnitCount, filteredUnits, units.length, hasMorePages, fetchNextPage, ensureLoaded]);

  // Handle load all
  const handleLoadAll = useCallback(async () => {
    loadAllAbortRef.current = false;
    setLoadingAll(true);
    
    // Fetch all pages first
    while (hasMorePages && !loadAllAbortRef.current) {
      await fetchNextPage();
    }
    
    // Progressive tax loading
    const allUnits = filteredUnits
      .filter((u) => u.unitBbl)
      .map((u) => ({ unitBbl: u.unitBbl, unitLabel: u.unitLabel }));
    const batchSize = 20;
    
    for (let i = 0; i < allUnits.length && !loadAllAbortRef.current; i += batchSize) {
      const batch = allUnits.slice(i, i + batchSize);
      ensureLoaded(batch);
      
      // Wait for batch with timeout
      await new Promise((resolve) => setTimeout(resolve, LOAD_ALL_BATCH_DELAY_MS));
    }
    
    if (!loadAllAbortRef.current) {
      setVisibleUnitCount(filteredUnits.length);
    }
    setLoadingAll(false);
  }, [hasMorePages, filteredUnits, fetchNextPage, ensureLoaded]);

  // Get tax summary for a unit
  const getTaxSummary = useCallback((unitBbl: string | undefined): CondoUnitTaxSummary | null => {
    if (!unitBbl) return null;
    const key = normalizeBbl(unitBbl);
    return unitTaxes.get(key) || null;
  }, [unitTaxes]);

  // Navigate to unit detail
  const handleOpenUnit = useCallback((unitBbl: string) => {
    if (!unitBbl) return;
    
    const params = new URLSearchParams({
      bbl: unitBbl,
      borough: buildingBorough || boroughNameFromBbl(unitBbl),
      address: buildingAddress || '',
      buildingBbl: bbl,
      buildingAddress: buildingAddress || '',
    });
    if (buildingBin) params.set('bin', buildingBin);
    
    navigate(`/results?${params.toString()}`);
  }, [navigate, bbl, buildingAddress, buildingBorough, buildingBin]);

  // Early returns
  if (isCoop) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Co-op buildings do not have individually taxed units. All regulatory records apply to the building level.
        </AlertDescription>
      </Alert>
    );
  }

  if (unitsLoading && units.length === 0) {
    return <LoadingSkeleton />;
  }

  if (unitsError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{unitsError.userMessage || unitsError.error}</AlertDescription>
      </Alert>
    );
  }

  if (!isCondo || units.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          This property is not a condominium or has no registered units.
        </AlertDescription>
      </Alert>
    );
  }

  const hasMore = visibleUnitCount < filteredUnits.length || hasMorePages;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            Condo Units
          </h2>
          <p className="text-sm text-muted-foreground">
            {totalUnits > 0 ? `${totalUnits} units total` : `${units.length} units loaded`}
          </p>
        </div>
        
        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search units..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Note about condo taxes */}
      <Alert className="bg-muted/50">
        <Info className="h-4 w-4" />
        <AlertDescription>
          Condo buildings do not have building-level tax liability. Each unit owner is responsible for their own property taxes.
        </AlertDescription>
      </Alert>

      {/* Units table or cards */}
      {isMobile ? (
        <div className="space-y-3">
          {displayedUnits.map((unit) => {
            const taxSummary = getTaxSummary(unit.unitBbl);
            return (
              <UnitCardMobile
                key={unit.unitBbl || unit.unitLabel}
                unit={unit}
                taxSummary={taxSummary}
                isCurrent={false}
                isBuilding={true}
                onOpenUnit={handleOpenUnit}
              />
            );
          })}
        </div>
      ) : (
        <TooltipProvider>
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Unit</TableHead>
                    <TableHead className="w-28">Lot</TableHead>
                    <TableHead className="w-32 text-right">Latest Bill</TableHead>
                    <TableHead className="w-28">Due Date</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-32 text-right">Arrears</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedUnits.map((unit) => {
                    const taxSummary = getTaxSummary(unit.unitBbl);
                    const isLoading = taxSummary?.loading;
                    const hasError = taxSummary?.error;
                    const hasData = taxSummary?.data && !taxSummary.data.no_data_found;
                    const noData = taxSummary?.data?.no_data_found;
                    
                    let statusInfo = null;
                    if (hasData && taxSummary.data) {
                      statusInfo = getPaymentStatusInfo(taxSummary.data.payment_status || null);
                    }
                    
                    return (
                      <TableRow key={unit.unitBbl || unit.unitLabel}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            <Home className="h-3.5 w-3.5 text-muted-foreground" />
                            {unit.unitLabel || 'N/A'}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {formatLot(unit.lot)}
                        </TableCell>
                        <TableCell className="text-right">
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin ml-auto" />
                          ) : hasError ? (
                            <span className="text-destructive text-sm">Error</span>
                          ) : noData ? (
                            <span className="text-muted-foreground text-sm">No bill</span>
                          ) : hasData ? (
                            <span className="font-medium">
                              {formatUSDForTable(taxSummary.data?.latest_bill_amount)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {hasData ? (
                            <span className="text-sm">
                              {formatDate(taxSummary.data?.latest_due_date || null)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {statusInfo ? (
                            <Badge 
                              variant="outline" 
                              className={cn("text-xs", statusInfo.className)}
                            >
                              {statusInfo.label}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {hasData && taxSummary.data?.arrears && taxSummary.data.arrears > 0 ? (
                            <span className="text-destructive font-medium">
                              {formatUSDForTable(taxSummary.data.arrears)}
                            </span>
                          ) : hasData ? (
                            <span className="text-green-600">$0</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenUnit(unit.unitBbl)}
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </TooltipProvider>
      )}

      {/* Pagination / Load more */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
        <p className="text-sm text-muted-foreground">
          Showing {displayedUnits.length} of {filteredUnits.length} units
          {searchTerm && ` (filtered from ${units.length})`}
        </p>
        
        {hasMore && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={loadingMore || loadingAll}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  Loading...
                </>
              ) : (
                `Load next ${UNITS_PAGE_SIZE}`
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLoadAll}
              disabled={loadingAll}
            >
              {loadingAll ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  Loading all...
                </>
              ) : (
                'Load all'
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Tax loading indicator */}
      {taxBatchLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading tax data...
        </div>
      )}
    </div>
  );
}
