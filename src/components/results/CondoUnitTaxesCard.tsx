import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  DollarSign, 
  Building2, 
  Home, 
  AlertCircle, 
  Info, 
  ChevronDown, 
  ChevronUp,
  CheckCircle2, 
  XCircle, 
  Clock,
  Loader2,
  ExternalLink
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useCondoUnitTaxes, INITIAL_BATCH_SIZE, type CondoUnitTaxSummary } from '@/hooks/useCondoUnitTaxes';
import type { CondoUnit } from '@/hooks/useCondoUnits';
import type { PaymentStatus } from '@/hooks/usePropertyTaxes';

interface CondoUnitTaxesCardProps {
  // Condo units from useCondoUnits hook
  units: CondoUnit[];
  // Total unit count (may be more than loaded)
  totalUnitCount: number;
  // Building info for navigation
  billingBbl: string | null;
  buildingAddress?: string;
  borough?: string;
  bin?: string;
  // Is data still loading from condo-units API?
  unitsLoading?: boolean;
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

function boroughNameFromBbl(bbl: string): string {
  const borough = bbl.substring(0, 1);
  return {
    '1': 'Manhattan',
    '2': 'Bronx',
    '3': 'Brooklyn',
    '4': 'Queens',
    '5': 'Staten Island',
  }[borough] || 'Unknown';
}

function formatLot(lot: string): string {
  const n = Number(lot);
  if (Number.isFinite(n)) return String(Math.trunc(n));
  return lot;
}

// Unit tax row component - memoized for performance
function UnitTaxRow({ 
  unitTax, 
  onOpenUnit 
}: { 
  unitTax: CondoUnitTaxSummary; 
  onOpenUnit: (bbl: string) => void;
}) {
  const displayLabel = unitTax.unitLabel || `Lot ${formatLot(unitTax.unitBbl.slice(6))}`;
  const statusInfo = unitTax.data ? getPaymentStatusInfo(unitTax.data.payment_status) : null;
  const hasArrears = unitTax.data?.arrears !== null && 
                     unitTax.data?.arrears !== undefined && 
                     unitTax.data.arrears > 0;

  return (
    <TableRow>
      {/* Unit Label */}
      <TableCell className="text-sm font-medium">
        {displayLabel}
      </TableCell>
      
      {/* Unit BBL */}
      <TableCell className="font-mono text-xs text-muted-foreground">
        {unitTax.unitBbl}
      </TableCell>
      
      {/* Latest Bill */}
      <TableCell className="text-sm">
        {unitTax.loading ? (
          <Skeleton className="h-4 w-16" />
        ) : unitTax.error ? (
          <span className="text-destructive text-xs">Error</span>
        ) : unitTax.data?.no_data_found ? (
          <span className="text-muted-foreground text-xs">No data</span>
        ) : (
          formatUSD(unitTax.data?.latest_bill_amount)
        )}
      </TableCell>
      
      {/* Due Date */}
      <TableCell className="text-sm text-muted-foreground">
        {unitTax.loading ? (
          <Skeleton className="h-4 w-20" />
        ) : unitTax.error || unitTax.data?.no_data_found ? (
          '—'
        ) : (
          formatDate(unitTax.data?.latest_due_date)
        )}
      </TableCell>
      
      {/* Status */}
      <TableCell>
        {unitTax.loading ? (
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
        {unitTax.loading ? (
          <Skeleton className="h-4 w-12" />
        ) : hasArrears ? (
          <Badge variant="destructive" className="text-xs">
            {formatUSD(unitTax.data?.arrears)}
          </Badge>
        ) : unitTax.data?.arrears_available ? (
          <span className="text-muted-foreground text-xs">None</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      
      {/* Action */}
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenUnit(unitTax.unitBbl)}
          className="gap-1"
        >
          <Home className="h-3.5 w-3.5" />
          Open unit
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function CondoUnitTaxesCard({ 
  units, 
  totalUnitCount,
  billingBbl,
  buildingAddress,
  borough,
  bin,
  unitsLoading = false,
}: CondoUnitTaxesCardProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);
  
  // Track how many units to show - stable across renders
  const [visibleCount, setVisibleCount] = useState(INITIAL_BATCH_SIZE);
  
  // Track the building BBL to detect navigation changes
  const lastBillingBblRef = useRef<string | null>(null);
  
  const {
    unitTaxes,
    fetchBatch,
    reset,
    batchLoading,
    loadedCount,
    arrearsCount,
    unpaidCount,
  } = useCondoUnitTaxes();

  // Reset state when navigating to a different building
  useEffect(() => {
    if (billingBbl !== lastBillingBblRef.current) {
      lastBillingBblRef.current = billingBbl;
      setVisibleCount(INITIAL_BATCH_SIZE);
      reset();
    }
  }, [billingBbl, reset]);

  // Get visible units for display - stable computation
  const visibleUnits = useMemo(() => {
    return units.slice(0, visibleCount);
  }, [units, visibleCount]);

  // Fetch taxes for visible units when they change
  // FIXED: Only fetch units not already in the map to prevent double-fetching
  useEffect(() => {
    if (visibleUnits.length === 0) return;

    // Compute which units need fetching based on current unitTaxes state
    const unitsToFetch = visibleUnits
      .filter(u => !unitTaxes.has(u.unitBbl))
      .map(u => ({ unitBbl: u.unitBbl, unitLabel: u.unitLabel }));

    if (unitsToFetch.length > 0) {
      fetchBatch(unitsToFetch);
    }
  }, [visibleUnits, fetchBatch]); // Note: unitTaxes intentionally excluded to prevent infinite loop

  const handleOpenUnit = useCallback((unitBbl: string) => {
    const params = new URLSearchParams();
    params.set('bbl', unitBbl);
    params.set('borough', borough || boroughNameFromBbl(unitBbl));
    
    if (buildingAddress) {
      params.set('buildingAddress', buildingAddress);
    }
    if (billingBbl) {
      params.set('buildingBbl', billingBbl);
    }
    if (bin) {
      params.set('bin', bin);
    }
    
    navigate(`/results?${params.toString()}`);
  }, [navigate, borough, buildingAddress, billingBbl, bin]);

  // FIXED: Load more now properly increments and triggers fetch via useEffect
  const handleLoadMore = useCallback(() => {
    const newCount = Math.min(visibleCount + INITIAL_BATCH_SIZE, units.length);
    setVisibleCount(newCount);
  }, [visibleCount, units.length]);

  const hasMore = visibleCount < units.length;
  const remainingCount = units.length - visibleCount;

  // Build unit tax summaries for display - pure derivation from state
  const unitTaxSummaries = useMemo(() => {
    return visibleUnits.map(unit => {
      const existing = unitTaxes.get(unit.unitBbl);
      if (existing) return existing;
      
      // Not yet fetched - show as loading
      return {
        unitBbl: unit.unitBbl,
        unitLabel: unit.unitLabel,
        loading: true,
        error: null,
        data: null,
      } as CondoUnitTaxSummary;
    });
  }, [visibleUnits, unitTaxes]);

  // Still loading condo units data
  if (unitsLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Condo Unit Taxes</CardTitle>
          </div>
          <CardDescription>Loading condo unit information...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // No units found
  if (units.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Condo Unit Taxes</CardTitle>
          </div>
          <CardDescription className="flex items-center gap-2">
            <span>NYC Department of Finance property tax</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              Condominium
            </Badge>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <p>No condo unit lots found for this building.</p>
              <p className="text-muted-foreground text-xs mt-1">
                Individual unit taxes may be accessed via NYC CityPay.
              </p>
            </AlertDescription>
          </Alert>
          
          {/* Link to NYC CityPay */}
          <div className="mt-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => window.open('https://a836-citypay.nyc.gov/citypay/PropertyTax', '_blank')}
            >
              <ExternalLink className="h-4 w-4" />
              View on NYC CityPay
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Condo Unit Taxes</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {batchLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-sm">
                    Condominium taxes are assessed at the unit level, not the building level.
                    Each unit has its own tax bill and payment status.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <CardDescription className="flex items-center gap-2">
          <span>NYC Department of Finance property tax</span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            Condominium
          </Badge>
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Total units:</span>
            <Badge variant="outline" className="font-mono">
              {totalUnitCount}
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Loaded:</span>
            <Badge variant="secondary" className="font-mono">
              {loadedCount} of {units.length}
            </Badge>
          </div>
          
          {unpaidCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {unpaidCount} unpaid
            </Badge>
          )}
          
          {arrearsCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {arrearsCount} with arrears
            </Badge>
          )}
        </div>
        
        {/* Building-level tax suppression notice */}
        <Alert className="py-2 border-primary/30 bg-primary/5">
          <Info className="h-4 w-4 text-primary" />
          <AlertDescription className="text-xs">
            <strong>Condominium buildings do not have building-level tax liability.</strong>{' '}
            All property taxes shown below are unit-specific.
          </AlertDescription>
        </Alert>
        
        {/* Collapsible Unit Tax Table */}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full justify-between h-8"
            >
              <span className="text-sm">
                Unit Tax Preview ({Math.min(visibleCount, units.length)} of {units.length} units)
              </span>
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <div className="mt-3 border rounded-md">
              <ScrollArea className={unitTaxSummaries.length > 8 ? 'h-96' : undefined}>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="font-semibold">Unit</TableHead>
                      <TableHead className="font-semibold">Unit BBL</TableHead>
                      <TableHead className="font-semibold">Latest Bill</TableHead>
                      <TableHead className="font-semibold">Due Date</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Arrears</TableHead>
                      <TableHead className="font-semibold text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unitTaxSummaries.map(unitTax => (
                      <UnitTaxRow
                        key={unitTax.unitBbl}
                        unitTax={unitTax}
                        onOpenUnit={handleOpenUnit}
                      />
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              
              {/* Load More / Additional units notice */}
              {hasMore && (
                <div className="p-3 border-t text-center space-y-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleLoadMore}
                    disabled={batchLoading}
                  >
                    {batchLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Loading...
                      </>
                    ) : (
                      `Load more (${remainingCount} remaining)`
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Additional unit tax details available — open unit to view full history
                  </p>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
        
        {/* External Link */}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-xs text-muted-foreground"
            onClick={() => window.open('https://a836-citypay.nyc.gov/citypay/PropertyTax', '_blank')}
          >
            <ExternalLink className="h-3 w-3" />
            NYC CityPay
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
