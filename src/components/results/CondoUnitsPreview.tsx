import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, ChevronRight, ChevronDown, ChevronUp, Loader2, Home, AlertCircle, Bug, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { CondoUnitsResponse, CondoUnit } from '@/hooks/useCondoUnits';
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

// Unit pill button — compact inline style
function UnitPreviewRow({
  unit,
  onClick,
}: {
  unit: CondoUnit;
  onClick: () => void;
}) {
  const displayLabel = unit.unitLabel || `Lot ${unit.lot}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors",
        "hover:bg-primary/10 hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        "bg-card text-card-foreground"
      )}
    >
      <Home className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium">{displayLabel}</span>
      <ChevronRight className="h-3 w-3 text-muted-foreground" />
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

  // Expanded state — "View all" toggles this
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Preview first 6 units (show enough to be useful, not overwhelming)
  const previewUnits = useMemo(() => units.slice(0, 6), [units]);

  // Filtered units for expanded view
  const filteredUnits = useMemo(() => {
    if (!searchQuery.trim()) return units;
    const q = searchQuery.trim().toLowerCase();
    return units.filter(u =>
      (u.unitLabel || '').toLowerCase().includes(q) ||
      u.unitBbl.includes(q) ||
      String(u.lot).includes(q)
    );
  }, [units, searchQuery]);



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
    <div id="scroll-units" className="relative z-10 pointer-events-auto scroll-mt-20">
      <Card className="border-primary/20 bg-card">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground shrink-0">
              <Building2 className="h-4 w-4" />
              <span>{totalUnits} Units</span>
            </div>

            {/* Compact horizontal grid of unit buttons */}
            {!expanded && (
              <div className="flex items-center gap-2 flex-wrap flex-1">
                {previewUnits.map((unit) => (
                  <UnitPreviewRow
                    key={unit.unitBbl}
                    unit={unit}
                    onClick={() => onSelectUnit?.(unit.unitBbl, unit.unitLabel)}
                  />
                ))}

                {totalUnits > 6 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpanded(true)}
                    className="text-xs text-muted-foreground hover:text-foreground h-8 px-2"
                  >
                    +{totalUnits - 6} more
                  </Button>
                )}
              </div>
            )}

            {expanded && <div className="flex-1" />}

            <Button
              type="button"
              onClick={() => setExpanded(!expanded)}
              variant="outline"
              size="sm"
              className="gap-1 pointer-events-auto shrink-0"
            >
              {expanded ? 'Collapse' : 'View all'}
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>

          {/* Expanded: full unit grid with search */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-border">
              {units.length > 12 && (
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder={`Search ${totalUnits} units...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
              )}
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-1.5 max-h-[400px] overflow-y-auto">
                {filteredUnits.map((unit) => (
                  <UnitPreviewRow
                    key={unit.unitBbl}
                    unit={unit}
                    onClick={() => onSelectUnit?.(unit.unitBbl, unit.unitLabel)}
                  />
                ))}
              </div>
              {searchQuery && filteredUnits.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">No units match "{searchQuery}"</p>
              )}
              {filteredUnits.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {searchQuery ? `${filteredUnits.length} of ${totalUnits} units` : `${totalUnits} units`} — click any unit to view details
                </p>
              )}
            </div>
          )}

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
      </Card>
    </div>
  );
}
