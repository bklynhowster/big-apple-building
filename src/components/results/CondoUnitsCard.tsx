import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Building2, Home, Search, ArrowLeft, AlertCircle, Info, Loader2, RefreshCw, CheckCircle2, XCircle, Clock, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCondoUnits, type CondoUnit, type CondoUnitsInputRole } from '@/hooks/useCondoUnits';
import { 
  useCondoUnitTaxes, 
  INITIAL_TAX_BATCH_SIZE,
  type CondoUnitTaxSummary,
  type PaymentStatus,
  formatUSDForTable,
  formatDate,
  formatLot,
  getPaymentStatusInfo,
} from '@/features/taxes';

// Page size for displaying units (client-side pagination)
const UNITS_PAGE_SIZE = 25;

interface CondoUnitsCardProps {
  bbl: string;
  buildingAddress?: string;
  borough?: string;
  bin?: string;
  onUnitLabelResolved?: (unitLabel: string | null) => void;
  onBillingBblResolved?: (billingBbl: string) => void;
  onCondoDataResolved?: (data: {
    units: CondoUnit[];
    totalApprox: number;
    isCondo: boolean;
    inputRole: CondoUnitsInputRole;
    loading: boolean;
  }) => void;
  hidden?: boolean;
}

function LoadingSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-5 w-32" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </CardContent>
    </Card>
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

function formatLot(lot: string): string {
  const n = Number(lot);
  if (Number.isFinite(n)) return String(Math.trunc(n));
  return lot;
}

// Safe USD formatter
function formatUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getPaymentStatusInfo(status: PaymentStatus | undefined): { 
  label: string; 
  variant: 'default' | 'destructive' | 'secondary' | 'outline';
  icon: React.ReactNode;
} | null {
  switch (status) {
    case 'paid':
      return { label: 'Paid', variant: 'default', icon: <CheckCircle2 className="h-3 w-3" /> };
    case 'unpaid':
      return { label: 'Unpaid', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> };
    case 'unknown':
      return { label: 'Unknown', variant: 'secondary', icon: <Clock className="h-3 w-3" /> };
    default:
      return null;
  }
}

export function CondoUnitsCard({ 
  bbl, 
  buildingAddress, 
  borough: buildingBorough, 
  bin: buildingBin,
  onUnitLabelResolved, 
  onBillingBblResolved,
  onCondoDataResolved,
  hidden 
}: CondoUnitsCardProps) {
  const navigate = useNavigate();
  const { loading, loadingMore, error, data, fetchFirstPage, fetchNextPage, retry } = useCondoUnits();
  const [searchQuery, setSearchQuery] = useState('');
  
  // Client-side pagination: how many units to show in the table
  const [visibleUnitCount, setVisibleUnitCount] = useState(UNITS_PAGE_SIZE);
  
  // Tax lazy loading state - how many units to load taxes for
  const [taxVisibleCount, setTaxVisibleCount] = useState(INITIAL_BATCH_SIZE);
  const lastBblRef = useRef<string | null>(null);
  
  // Tax hook
  const {
    unitTaxes,
    fetchBatch,
    fetchOne,
    reset: resetTaxes,
    batchLoading: taxBatchLoading,
    loadedCount: taxLoadedCount,
    arrearsCount,
    unpaidCount,
  } = useCondoUnitTaxes();

  const lotLooksLikeBilling = useMemo(() => {
    if (!bbl || bbl.length !== 10) return false;
    const lot = bbl.slice(6, 10);
    const n = Number(lot);
    return Number.isFinite(n) && n >= 7501 && n <= 7599;
  }, [bbl]);

  // Find current unit's label when input is a unit BBL
  useEffect(() => {
    if (!data || !onUnitLabelResolved) return;

    if (data.inputRole === 'unit' && data.units.length > 0) {
      const currentUnit = data.units.find((u) => u.unitBbl === data.inputBbl);
      if (currentUnit) {
        onUnitLabelResolved(currentUnit.unitLabel);
        return;
      }
    }
    onUnitLabelResolved(null);
  }, [data, onUnitLabelResolved]);

  // Pass billing BBL up to parent
  useEffect(() => {
    if (onBillingBblResolved) {
      onBillingBblResolved(data?.billingBbl || null);
    }
  }, [data?.billingBbl, onBillingBblResolved]);

  // Pass condo data up to parent
  useEffect(() => {
    if (onCondoDataResolved) {
      onCondoDataResolved({
        units: data?.units || [],
        totalApprox: data?.totalApprox || 0,
        isCondo: data?.isCondo || false,
        inputRole: data?.inputRole || 'unknown',
        loading,
      });
    }
  }, [data, loading, onCondoDataResolved]);

  // Fetch condo units on BBL change
  useEffect(() => {
    if (bbl && bbl.length === 10) {
      fetchFirstPage(bbl, 2000);
    }
  }, [bbl, fetchFirstPage]);

  // Reset state when BBL changes
  useEffect(() => {
    if (bbl !== lastBblRef.current) {
      lastBblRef.current = bbl;
      setVisibleUnitCount(UNITS_PAGE_SIZE);
      setTaxVisibleCount(INITIAL_BATCH_SIZE);
      resetTaxes();
    }
  }, [bbl, resetTaxes]);

  // Determine if this is a building-level view (not a unit page)
  const isBuilding = data?.inputRole === 'billing' || data?.inputRole === 'unknown';

  // Get visible units for tax fetching (only on building pages, not unit pages)
  const unitsForTaxFetch = useMemo(() => {
    if (!data?.units || !isBuilding) return [];
    return data.units.slice(0, taxVisibleCount);
  }, [data?.units, taxVisibleCount, isBuilding]);

  // Fetch taxes for visible units when they change (only on building pages)
  useEffect(() => {
    if (!isBuilding || unitsForTaxFetch.length === 0) return;
    
    // Compute which units need fetching
    const unitsToFetch = unitsForTaxFetch
      .filter(u => !unitTaxes.has(u.unitBbl))
      .map(u => ({ unitBbl: u.unitBbl, unitLabel: u.unitLabel }));

    if (unitsToFetch.length > 0) {
      fetchBatch(unitsToFetch);
    }
  }, [unitsForTaxFetch, fetchBatch, isBuilding, data?.units?.length]); // unitTaxes intentionally excluded

  // Filter units by search query (searches across ALL loaded units)
  const filteredUnits = useMemo(() => {
    if (!data?.units) return [];
    if (!searchQuery.trim()) return data.units;

    const q = searchQuery.toLowerCase();
    return data.units.filter((u) => {
      const fallbackLabel = `lot ${formatLot(u.lot)}`;
      return (
        u.unitBbl.includes(q) ||
        String(u.lot).includes(q) ||
        (u.unitLabel && u.unitLabel.toLowerCase().includes(q)) ||
        fallbackLabel.includes(q)
      );
    });
  }, [data?.units, searchQuery]);

  // Units to display (client-side pagination) - only applies when NOT searching
  const displayedUnits = useMemo(() => {
    if (searchQuery.trim()) {
      // When searching, show all filtered results (up to a reasonable limit)
      return filteredUnits.slice(0, Math.max(visibleUnitCount, 100));
    }
    return filteredUnits.slice(0, visibleUnitCount);
  }, [filteredUnits, visibleUnitCount, searchQuery]);

  // Pagination state
  const totalFilteredUnits = filteredUnits.length;
  const displayedCount = displayedUnits.length;
  const hasMoreUnitsToShow = displayedCount < totalFilteredUnits;

  const currentUnitBbl = data?.inputRole === 'unit' ? data.inputBbl : null;

  const handleOpenUnit = useCallback((unitBbl: string) => {
    const params = new URLSearchParams();
    params.set('bbl', unitBbl);
    params.set('borough', buildingBorough || boroughNameFromBbl(unitBbl));
    
    if (buildingAddress) {
      params.set('buildingAddress', buildingAddress);
    }
    if (data?.billingBbl) {
      params.set('buildingBbl', data.billingBbl);
    }
    if (buildingBin) {
      params.set('bin', buildingBin);
    }
    
    navigate(`/results?${params.toString()}`);
  }, [navigate, buildingBorough, buildingAddress, data?.billingBbl, buildingBin]);

  const handleBackToBuilding = () => {
    if (!data?.billingBbl) return;
    const params = new URLSearchParams();
    params.set('bbl', data.billingBbl);
    params.set('borough', buildingBorough || boroughNameFromBbl(data.billingBbl));
    if (buildingAddress) {
      params.set('address', buildingAddress);
    }
    if (buildingBin) {
      params.set('bin', buildingBin);
    }
    navigate(`/results?${params.toString()}`);
  };

  // Load more units in the display (client-side pagination)
  const handleLoadMoreUnits = useCallback(() => {
    setVisibleUnitCount((prev) => Math.min(prev + UNITS_PAGE_SIZE, totalFilteredUnits));
  }, [totalFilteredUnits]);

  // Load all units in the display
  const handleLoadAllUnits = useCallback(() => {
    setVisibleUnitCount(totalFilteredUnits);
  }, [totalFilteredUnits]);

  // Load more taxes - increases visible count for tax fetching
  const handleLoadMoreTaxes = useCallback(() => {
    const totalUnits = data?.units?.length || 0;
    const newCount = Math.min(taxVisibleCount + INITIAL_BATCH_SIZE, totalUnits);
    setTaxVisibleCount(newCount);
  }, [taxVisibleCount, data?.units?.length]);

  // Load all taxes
  const handleLoadAllTaxes = useCallback(() => {
    const totalUnits = data?.units?.length || 0;
    setTaxVisibleCount(totalUnits);
  }, [data?.units?.length]);

  // Retry a single unit's tax fetch
  const handleRetryTax = useCallback((unitBbl: string, unitLabel: string | null) => {
    fetchOne(unitBbl, unitLabel);
  }, [fetchOne]);

  // Get tax summary for a unit
  const getTaxSummary = useCallback((unitBbl: string, unitLabel: string | null): CondoUnitTaxSummary | null => {
    if (!isBuilding) return null;
    
    const existing = unitTaxes.get(unitBbl);
    if (existing) return existing;
    
    // Check if this unit is in the tax fetch range
    const unitIndex = data?.units?.findIndex(u => u.unitBbl === unitBbl) ?? -1;
    if (unitIndex >= 0 && unitIndex < taxVisibleCount) {
      // Should be loading
      return {
        unitBbl,
        unitLabel,
        loading: true,
        error: null,
        data: null,
      };
    }
    
    return null; // Not yet in fetch range
  }, [isBuilding, unitTaxes, data?.units, taxVisibleCount]);

  if (loading) return hidden ? null : <LoadingSkeleton />;

  if (error) {
    const isNetworkError = error.error === 'Internal server error' || 
                           error.error === 'Network error' ||
                           error.error?.toLowerCase().includes('fetch') ||
                           error.error?.toLowerCase().includes('timeout');
    
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Condo Units
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant={isNetworkError ? "destructive" : "default"}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>{error.userMessage || 'Failed to load condo units.'}</span>
              {isNetworkError && (
                <Button variant="outline" size="sm" onClick={retry} className="ml-2">
                  Retry
                </Button>
              )}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // Hidden mode - just trigger the callbacks, don't render UI
  if (hidden) return null;

  // Visible when the property is a condo OR the lot looks like a condo billing lot (75xx).
  if (!data.isCondo && !lotLooksLikeBilling) return null;

  // Defensive: ensure units is always an array
  const units = Array.isArray(data.units) ? data.units : [];
  const hasUnits = units.length > 0;
  const totalUnits = units.length;
  
  // Tax loading progress
  const hasMoreTaxes = taxVisibleCount < totalUnits && isBuilding;
  const taxRemainingCount = totalUnits - taxVisibleCount;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              Condo Units
            </CardTitle>
            {isBuilding && hasUnits && (
              <CardDescription className="mt-1 flex items-center gap-2">
                <span>NYC Department of Finance property tax</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  Condominium
                </Badge>
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {data.isCondo ? 'Condominium' : 'Possible condo'}
            </Badge>
            {data.strategyUsed === 'blockLotFallback' && hasUnits && (
              <Badge variant="outline" className="text-xs">
                Units found via block-based condo fallback
              </Badge>
            )}
            {taxBatchLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Empty state: condo detected but no unit records available */}
        {!hasUnits ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              This condominium is billed at the building level or unit-level tax records are not available in NYC datasets.
              {data.billingBbl && (
                <span className="block mt-1 text-xs text-muted-foreground">
                  Billing BBL: <span className="font-mono">{data.billingBbl}</span>
                </span>
              )}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Building-level tax suppression notice - only on building pages */}
            {isBuilding && (
              <Alert className="py-2 border-primary/30 bg-primary/5">
                <Info className="h-4 w-4 text-primary" />
                <AlertDescription className="text-xs">
                  <strong>Condominium buildings do not have building-level tax liability.</strong>{' '}
                  All property taxes shown below are unit-specific.
                </AlertDescription>
              </Alert>
            )}

            {/* Stats row */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Total units:</p>
                <Badge variant="outline" className="font-mono">
                  {data.totalApprox || units.length}
                </Badge>
              </div>

              {isBuilding && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">Tax preview loaded:</p>
                  <Badge variant="secondary" className="font-mono">
                    {taxLoadedCount} / {totalUnits}
                  </Badge>
                </div>
              )}

              {data.billingBbl && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">Billing BBL</p>
                  <Badge variant="outline" className="font-mono">
                    {data.billingBbl}
                  </Badge>
                </div>
              )}

              {data.inputRole === 'unit' && (
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">Current unit</p>
                  <Badge variant="secondary" className="font-mono">
                    {data.inputBbl}
                  </Badge>
                </div>
              )}

              {data.inputRole === 'unit' && data.billingBbl && (
                <Button variant="outline" size="sm" onClick={handleBackToBuilding} className="gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to building
                </Button>
              )}

              {isBuilding && unpaidCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {unpaidCount} unpaid
                </Badge>
              )}

              {isBuilding && arrearsCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {arrearsCount} with arrears
                </Badge>
              )}
            </div>

            {/* Tax loading controls - only on building pages */}
            {isBuilding && hasMoreTaxes && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMoreTaxes}
                  disabled={taxBatchLoading}
                  className="gap-1.5"
                >
                  {taxBatchLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Load taxes for next {Math.min(INITIAL_BATCH_SIZE, taxRemainingCount)}
                </Button>
                {taxRemainingCount > INITIAL_BATCH_SIZE && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLoadAllTaxes}
                    disabled={taxBatchLoading}
                    className="text-xs"
                  >
                    Load all ({taxRemainingCount} remaining)
                  </Button>
                )}
              </div>
            )}

            {/* Search + showing indicator */}
            <div className="flex flex-col gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by unit label, lot, or BBL…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing <strong className="text-foreground">{displayedCount}</strong> of{' '}
                  <strong className="text-foreground">{totalFilteredUnits}</strong> units
                  {searchQuery.trim() && totalFilteredUnits !== totalUnits && (
                    <span className="ml-1">(filtered from {totalUnits} total)</span>
                  )}
                </span>
                {searchQuery.trim() && hasMoreUnitsToShow && (
                  <span className="text-muted-foreground italic">
                    Search covers loaded units only
                  </span>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="border rounded-md">
              <ScrollArea className={displayedUnits.length > 10 ? 'h-96' : undefined}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Unit label</TableHead>
                      <TableHead className="font-semibold">Unit BBL</TableHead>
                      <TableHead className="font-semibold">Lot</TableHead>
                      {/* Tax columns - only on building pages */}
                      {isBuilding && (
                        <>
                          <TableHead className="font-semibold">Latest Bill</TableHead>
                          <TableHead className="font-semibold">Due Date</TableHead>
                          <TableHead className="font-semibold">Status</TableHead>
                          <TableHead className="font-semibold">Arrears</TableHead>
                        </>
                      )}
                      <TableHead className="font-semibold text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedUnits.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isBuilding ? 8 : 4} className="text-center text-sm text-muted-foreground py-8">
                          No units match your search.
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayedUnits.map((unit) => {
                        const isCurrent = Boolean(currentUnitBbl && unit.unitBbl === currentUnitBbl);
                        const displayLabel = unit.unitLabel || `Lot ${formatLot(unit.lot)}`;
                        const labelSource = unit.unitLabelSource || 'unknown';
                        const isLotFallback = !unit.unitLabel || labelSource === 'fallback.lot';
                        
                        // Get tax data for this unit
                        const taxSummary = getTaxSummary(unit.unitBbl, unit.unitLabel);
                        const statusInfo = taxSummary?.data ? getPaymentStatusInfo(taxSummary.data.payment_status) : null;
                        const hasArrears = taxSummary?.data?.arrears !== null && 
                                          taxSummary?.data?.arrears !== undefined && 
                                          taxSummary.data.arrears > 0;

                        return (
                          <TableRow key={unit.unitBbl} className={isCurrent ? 'bg-muted/40' : undefined}>
                            <TableCell className="text-sm">
                              <div className="flex items-center gap-2">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-help flex items-center gap-1">
                                        <span className={isLotFallback ? 'text-muted-foreground' : undefined}>
                                          {displayLabel}
                                        </span>
                                        {!isLotFallback && (
                                          <Info className="h-3 w-3 text-muted-foreground/60" />
                                        )}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <p className="text-xs">
                                        <strong>Source:</strong> {labelSource}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        Lot: {formatLot(unit.lot)}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                {isCurrent && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    Current
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{unit.unitBbl}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{formatLot(unit.lot)}</TableCell>
                            
                            {/* Tax columns - only on building pages */}
                            {isBuilding && (
                              <>
                                {/* Latest Bill */}
                                <TableCell className="text-sm">
                                  {!taxSummary ? (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  ) : taxSummary.loading ? (
                                    <Skeleton className="h-4 w-16" />
                                  ) : taxSummary.error ? (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-1 text-destructive"
                                            onClick={() => handleRetryTax(unit.unitBbl, unit.unitLabel)}
                                          >
                                            <RefreshCw className="h-3 w-3 mr-1" />
                                            <span className="text-xs">Retry</span>
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p className="text-xs">{taxSummary.error}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : taxSummary.data?.no_data_found ? (
                                    <span className="text-muted-foreground text-xs">No data</span>
                                  ) : (
                                    formatUSD(taxSummary.data?.latest_bill_amount)
                                  )}
                                </TableCell>
                                
                                {/* Due Date */}
                                <TableCell className="text-sm text-muted-foreground">
                                  {!taxSummary ? (
                                    '—'
                                  ) : taxSummary.loading ? (
                                    <Skeleton className="h-4 w-20" />
                                  ) : taxSummary.error || taxSummary.data?.no_data_found ? (
                                    '—'
                                  ) : (
                                    formatDate(taxSummary.data?.latest_due_date)
                                  )}
                                </TableCell>
                                
                                {/* Status */}
                                <TableCell>
                                  {!taxSummary ? (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  ) : taxSummary.loading ? (
                                    <Skeleton className="h-5 w-12" />
                                  ) : statusInfo ? (
                                    <Badge variant={statusInfo.variant} className="text-xs flex items-center gap-1 w-fit">
                                      {statusInfo.icon}
                                      {statusInfo.label}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </TableCell>
                                
                                {/* Arrears */}
                                <TableCell>
                                  {!taxSummary ? (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  ) : taxSummary.loading ? (
                                    <Skeleton className="h-4 w-12" />
                                  ) : hasArrears ? (
                                    <Badge variant="destructive" className="text-xs">
                                      {formatUSD(taxSummary.data?.arrears)}
                                    </Badge>
                                  ) : taxSummary.data?.arrears_available ? (
                                    <span className="text-muted-foreground text-xs">None</span>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </TableCell>
                              </>
                            )}
                            
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenUnit(unit.unitBbl)}
                                className="gap-1"
                              >
                                <Home className="h-3.5 w-3.5" />
                                Open unit
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>

              {/* Unit pagination controls */}
              {hasMoreUnitsToShow && (
                <div className="p-3 border-t flex items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMoreUnits}
                    className="gap-1.5"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    Load next {Math.min(UNITS_PAGE_SIZE, totalFilteredUnits - displayedCount)}
                  </Button>
                  {totalFilteredUnits - displayedCount > UNITS_PAGE_SIZE && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleLoadAllUnits}
                      className="text-xs"
                    >
                      Load all ({totalFilteredUnits - displayedCount} remaining)
                    </Button>
                  )}
                </div>
              )}
              {!hasMoreUnitsToShow && totalFilteredUnits > UNITS_PAGE_SIZE && (
                <div className="p-2 border-t text-center text-xs text-muted-foreground">
                  All {totalFilteredUnits} units loaded
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
