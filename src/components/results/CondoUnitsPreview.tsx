import { useEffect, useMemo } from 'react';
import { Building2, ChevronRight, Loader2, Home } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCondoUnits } from '@/hooks/useCondoUnits';
import type { CondoMeta } from './UnitsTab';

interface CondoUnitsPreviewProps {
  bbl: string;
  isCoop: boolean;
  onViewAllUnits: () => void;
  onCondoMetaResolved?: (meta: CondoMeta) => void;
}

export function CondoUnitsPreview({ 
  bbl, 
  isCoop, 
  onViewAllUnits,
  onCondoMetaResolved,
}: CondoUnitsPreviewProps) {
  const {
    loading,
    error,
    data: condoData,
    fetchFirstPage,
  } = useCondoUnits();

  // Fetch on mount
  useEffect(() => {
    if (bbl && bbl.length === 10 && !isCoop) {
      fetchFirstPage(bbl);
    }
  }, [bbl, isCoop, fetchFirstPage]);

  // Report condo metadata to parent
  useEffect(() => {
    if (!onCondoMetaResolved || !condoData) return;
    
    let unitLabel: string | null = null;
    if (condoData.inputRole === 'unit' && condoData.units.length > 0) {
      const currentUnit = condoData.units.find((u) => u.unitBbl === condoData.inputBbl);
      if (currentUnit) {
        unitLabel = currentUnit.unitLabel;
      }
    }
    
    onCondoMetaResolved({
      isCondo: condoData.isCondo,
      billingBbl: condoData.billingBbl,
      totalUnits: condoData.totalApprox || condoData.units.length,
      unitLabel,
    });
  }, [condoData, onCondoMetaResolved]);

  const units = condoData?.units || [];
  const totalUnits = condoData?.totalApprox || 0;
  const isCondo = condoData?.isCondo ?? false;

  // Preview first 5 units
  const previewUnits = useMemo(() => units.slice(0, 5), [units]);

  // Don't render for co-ops or non-condos
  if (isCoop) return null;
  if (!loading && !isCondo) return null;
  if (error) return null;

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
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {loading ? (
                  'Loading roster...'
                ) : (
                  `${totalUnits} registered units in this building`
                )}
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
      {!loading && previewUnits.length > 0 && (
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-2">
            {previewUnits.map((unit) => (
              <Badge 
                key={unit.unitBbl} 
                variant="secondary" 
                className="flex items-center gap-1.5 px-2.5 py-1"
              >
                <Home className="h-3 w-3" />
                {unit.unitLabel || `Lot ${unit.lot}`}
              </Badge>
            ))}
            {totalUnits > 5 && (
              <Badge variant="outline" className="px-2.5 py-1">
                +{totalUnits - 5} more
              </Badge>
            )}
          </div>
        </CardContent>
      )}
      
      {loading && (
        <CardContent className="pt-0">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-6 w-16" />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
