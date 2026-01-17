import { useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, ChevronRight, Loader2, Home, AlertCircle, Bug, DollarSign } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { CondoUnitsResponse, CondoUnit } from '@/hooks/useCondoUnits';
import type { ApiError } from '@/types/api-error';
import { cn } from '@/lib/utils';
import { useCondoUnitTaxes, INITIAL_TAX_BATCH_SIZE } from '@/features/taxes/hooks/useCondoUnitTaxes';
import type { CondoUnitTaxSummary } from '@/features/taxes/types';

interface CondoUnitsPreviewProps {
  searchBbl: string;
  rosterQueryBbl: string | null;
  condoData: CondoUnitsResponse | null;
  loading: boolean;
  error: ApiError | null;
  isCoop: boolean;
  onViewAllUnits: () => void;
  onSelectUnit?: (unitBbl: string, unitLabel?: string | null) => void;
}

// Debug panel shown when ?debug=1
function DebugPanel({ 
  searchBbl, 
  rosterQueryBbl, 
  billingBbl, 
  unitsCount, 
  totalUnits,
  error,
  isCondo,
  loading,
}: { 
  searchBbl: string; 
  rosterQueryBbl: string | null; 
  billingBbl: string | null; 
  unitsCount: number;
  totalUnits: number;
  error: string | null;
  isCondo: boolean;
  loading: boolean;
}) {
  return (
    <div className="mt-3 p-3 bg-amber-100 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded-md font-mono text-xs">
      <div className="flex items-center gap-2 mb-2 text-amber-800 dark:text-amber-200">
        <Bug className="h-3.5 w-3.5" />
        <strong>Debug (?debug=1)</strong>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-amber-900 dark:text-amber-100">
        <span>searchBbl:</span>
        <span className="font-bold">{searchBbl || '(none)'}</span>
        <span>rosterQueryBbl:</span>
        <span className="font-bold">{rosterQueryBbl || '(none)'}</span>
        <span>billingBbl:</span>
        <span className="font-bold">{billingBbl || '(none)'}</span>
        <span>isCondo:</span>
        <span className={cn("font-bold", isCondo ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>{String(isCondo)}</span>
        <span>units.length:</span>
        <span className={cn("font-bold", unitsCount > 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>{unitsCount}</span>
        <span>totalUnits:</span>
        <span className="font-bold">{totalUnits}</span>
        <span>loading:</span>
        <span className="font-bold">{String(loading)}</span>
        <span>error:</span>
        <span className={cn("font-bold", error ? "text-red-700 dark:text-red-400" : "")}>{error || '(none)'}</span>
      </div>
    </div>
  );
}

// Risk-based status styling (mirrors UnitOverviewCard)
type TaxRiskLevel = 'safe' | 'attention' | 'risk' | 'unknown';

function getTaxRiskLevel(taxSummary: CondoUnitTaxSummary | undefined): TaxRiskLevel {
  if (!taxSummary || taxSummary.loading || taxSummary.error || !taxSummary.data) return 'unknown';
  
  const { payment_status, arrears, no_data_found } = taxSummary.data;
  if (no_data_found) return 'unknown';
  
  const hasArrears = (arrears ?? 0) > 0;
  const isPaid = payment_status === 'paid';
  
  if (isPaid && !hasArrears) return 'safe';
  if (!isPaid && hasArrears) return 'risk';
  if (!isPaid) return 'attention';
  return 'safe';
}

const statusClasses: Record<TaxRiskLevel, { bg: string; text: string; border: string }> = {
  safe: { 
    bg: 'bg-green-100 dark:bg-green-900/30', 
    text: 'text-green-800 dark:text-green-300',
    border: 'border-green-200 dark:border-green-800'
  },
  attention: { 
    bg: 'bg-amber-100 dark:bg-amber-900/30', 
    text: 'text-amber-800 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800'
  },
  risk: { 
    bg: 'bg-red-100 dark:bg-red-900/30', 
    text: 'text-red-800 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800'
  },
  unknown: { 
    bg: 'bg-muted', 
    text: 'text-muted-foreground',
    border: 'border-border'
  },
};

function getStatusLabel(taxSummary: CondoUnitTaxSummary | undefined): string {
  if (!taxSummary) return '—';
  if (taxSummary.loading) return '...';
  if (taxSummary.error) return 'Error';
  if (!taxSummary.data || taxSummary.data.no_data_found) return 'No data';
  
  const { payment_status, arrears } = taxSummary.data;
  const hasArrears = (arrears ?? 0) > 0;
  
  if (payment_status === 'paid') return 'Paid';
  if (hasArrears) return 'Arrears';
  return 'Unpaid';
}

function formatAmount(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Unit row component with tax info
function UnitPreviewRow({ 
  unit, 
  taxSummary,
  onClick,
}: { 
  unit: CondoUnit; 
  taxSummary: CondoUnitTaxSummary | undefined;
  onClick: () => void;
}) {
  const displayLabel = unit.unitLabel || `Lot ${unit.lot}`;
  const riskLevel = getTaxRiskLevel(taxSummary);
  const statusLabel = getStatusLabel(taxSummary);
  const classes = statusClasses[riskLevel];
  
  const latestBill = taxSummary?.data?.latest_bill_amount;
  const arrears = taxSummary?.data?.arrears;
  const hasArrears = (arrears ?? 0) > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-colors",
        "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        "bg-card text-card-foreground"
      )}
    >
      {/* Left: Unit label */}
      <div className="flex items-center gap-2 min-w-0">
        <Home className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{displayLabel}</span>
      </div>
      
      {/* Middle: Amount (de-emphasized) */}
      <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground shrink-0">
        {taxSummary?.loading ? (
          <Skeleton className="h-4 w-16" />
        ) : latestBill ? (
          <>
            <DollarSign className="h-3 w-3" />
            <span>{formatAmount(latestBill)}</span>
          </>
        ) : null}
      </div>
      
      {/* Right: Status pill + arrears */}
      <div className="flex items-center gap-2 shrink-0">
        {hasArrears && !taxSummary?.loading && (
          <span className="text-xs font-semibold text-red-600 dark:text-red-400">
            ${arrears?.toLocaleString()}
          </span>
        )}
        <span className={cn(
          "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
          classes.bg, classes.text, classes.border
        )}>
          {statusLabel}
        </span>
      </div>
    </button>
  );
}

export function CondoUnitsPreview({ 
  searchBbl,
  rosterQueryBbl,
  condoData,
  loading,
  error,
  isCoop, 
  onViewAllUnits,
  onSelectUnit,
}: CondoUnitsPreviewProps) {
  const [searchParams] = useSearchParams();
  const showDebug = searchParams.get('debug') === '1';

  const units = condoData?.units || [];
  const totalUnits = condoData?.totalApprox || 0;
  const isCondo = condoData?.isCondo ?? false;
  const billingBbl = condoData?.billingBbl || null;

  // Preview first 6 units (show enough to be useful, not overwhelming)
  const previewUnits = useMemo(() => units.slice(0, 6), [units]);

  // Lazy-load tax data for preview units
  const { unitTaxes, ensureLoaded, batchLoading } = useCondoUnitTaxes();

  // Fetch tax data when preview units are available
  useEffect(() => {
    if (previewUnits.length > 0 && !loading) {
      const unitsToLoad = previewUnits.map(u => ({
        unitBbl: u.unitBbl,
        unitLabel: u.unitLabel,
      }));
      ensureLoaded(unitsToLoad);
    }
  }, [previewUnits, loading, ensureLoaded]);

  // Don't render for co-ops
  if (isCoop) return null;
  
  // Show loading state
  if (loading) {
    return (
      <Card className="border-primary/20 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 bg-primary/20 rounded-lg">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  Condo Units
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </CardTitle>
                <p className="text-sm text-muted-foreground">Loading roster...</p>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
          {showDebug && (
            <DebugPanel
              searchBbl={searchBbl}
              rosterQueryBbl={rosterQueryBbl}
              billingBbl={billingBbl}
              unitsCount={units.length}
              totalUnits={totalUnits}
              error={error?.userMessage || error?.error || null}
              isCondo={isCondo}
              loading={loading}
            />
          )}
        </CardContent>
      </Card>
    );
  }
  
  // Show error state
  if (error) {
    return (
      <Card className="border-destructive/20 bg-destructive/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-destructive/20 rounded-lg">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-lg">Condo Units</CardTitle>
              <p className="text-sm text-destructive">Failed to load roster</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error.userMessage || error.error}</AlertDescription>
          </Alert>
          {showDebug && (
            <DebugPanel
              searchBbl={searchBbl}
              rosterQueryBbl={rosterQueryBbl}
              billingBbl={billingBbl}
              unitsCount={units.length}
              totalUnits={totalUnits}
              error={error.userMessage || error.error}
              isCondo={isCondo}
              loading={loading}
            />
          )}
        </CardContent>
      </Card>
    );
  }
  
  // Don't render if not a condo (after loading complete)
  if (!isCondo) return null;

  return (
    <div className="relative z-10 pointer-events-auto">
      <Card className="border-primary/20 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 bg-primary/20 rounded-lg">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">Condo Units</CardTitle>
                  {batchLoading && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading taxes...
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {totalUnits} registered units in this building
                </p>
              </div>
            </div>
            <Button 
              type="button"
              onClick={onViewAllUnits} 
              variant="outline"
              className="gap-2 pointer-events-auto"
            >
              View all {totalUnits} units
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        
        {/* Preview list of first few units with tax info */}
        {previewUnits.length > 0 && (
          <CardContent className="pt-0">
            <div className="space-y-2 pointer-events-auto">
              {previewUnits.map((unit) => {
                const taxSummary = unitTaxes.get(unit.unitBbl);
                return (
                  <UnitPreviewRow
                    key={unit.unitBbl}
                    unit={unit}
                    taxSummary={taxSummary}
                    onClick={() => onSelectUnit?.(unit.unitBbl, unit.unitLabel)}
                  />
                );
              })}
              
              {/* Show how many more */}
              {totalUnits > 6 && (
                <div className="text-center pt-2">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={onViewAllUnits}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    + {totalUnits - 6} more units →
                  </Button>
                </div>
              )}
            </div>
            
            {showDebug && (
              <DebugPanel
                searchBbl={searchBbl}
                rosterQueryBbl={rosterQueryBbl}
                billingBbl={billingBbl}
                unitsCount={units.length}
                totalUnits={totalUnits}
                error={null}
                isCondo={isCondo}
                loading={loading}
              />
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
