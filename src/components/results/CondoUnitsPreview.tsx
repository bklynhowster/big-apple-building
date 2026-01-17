import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, ChevronRight, Loader2, Home, AlertCircle, Bug } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { CondoUnitsResponse } from '@/hooks/useCondoUnits';
import type { ApiError } from '@/types/api-error';
import { cn } from '@/lib/utils';

interface CondoUnitsPreviewProps {
  searchBbl: string;
  rosterQueryBbl: string | null;
  condoData: CondoUnitsResponse | null;
  loading: boolean;
  error: ApiError | null;
  isCoop: boolean;
  onViewAllUnits: () => void;
  onSelectUnit?: (unitBbl: string, unitLabel: string) => void;
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

  // Preview first 10 units
  const previewUnits = useMemo(() => units.slice(0, 10), [units]);

  // Don't render for co-ops
  if (isCoop) return null;
  
  // Show loading state
  if (loading) {
    return (
      <Card className="border-primary/20 bg-primary/5">
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
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-7 w-16" />
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
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-primary/20 rounded-lg">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Condo Units</CardTitle>
              <p className="text-sm text-muted-foreground">
                {totalUnits} registered units in this building
              </p>
            </div>
          </div>
          <Button onClick={onViewAllUnits} className="gap-2">
            View All Units
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      
      {/* Preview of first few units */}
      {previewUnits.length > 0 && (
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2">
            {previewUnits.map((unit) => (
              <button
                key={unit.unitBbl}
                type="button"
                onClick={() => onSelectUnit?.(unit.unitBbl, unit.unitLabel || `Lot ${unit.lot}`)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 cursor-pointer transition-colors"
              >
                <Home className="h-3 w-3" />
                {unit.unitLabel || `Lot ${unit.lot}`}
              </button>
            ))}
            {totalUnits > 10 && (
              <Badge variant="outline" className="px-2.5 py-1">
                +{totalUnits - 10} more
              </Badge>
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
  );
}
