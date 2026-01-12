import { CheckCircle2, Home, AlertCircle, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface UnitStatusPanelProps {
  unitLabel?: string | null;
  unitBbl: string;
  loading?: boolean;
  unitHasRecords: boolean;
  unitOpenCount: number;
}

export function UnitStatusPanel({
  unitLabel,
  unitBbl,
  loading,
  unitHasRecords,
  unitOpenCount,
}: UnitStatusPanelProps) {
  if (loading) {
    return (
      <Card className="border-2 border-muted">
        <CardContent className="py-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-4 w-48" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasIssues = unitHasRecords && unitOpenCount > 0;

  return (
    <Card className={cn(
      "border-2",
      hasIssues 
        ? "border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20" 
        : "border-green-500/50 bg-green-50/50 dark:bg-green-950/20"
    )}>
      <CardContent className="py-6">
        <div className="flex items-start gap-4">
          {/* Status Icon */}
          <div className={cn(
            "flex items-center justify-center h-12 w-12 rounded-full shrink-0",
            hasIssues 
              ? "bg-yellow-100 dark:bg-yellow-900/50" 
              : "bg-green-100 dark:bg-green-900/50"
          )}>
            {hasIssues ? (
              <AlertCircle className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
            ) : (
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            )}
          </div>

          {/* Status Content */}
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">
                Condominium Unit {unitLabel || unitBbl.slice(-4)} — Unit Status
              </h2>
            </div>

            {hasIssues ? (
              <p className="text-yellow-700 dark:text-yellow-300">
                {unitOpenCount} open unit-specific issue{unitOpenCount !== 1 ? 's' : ''} found.
              </p>
            ) : (
              <p className="text-green-700 dark:text-green-300 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                No unit-specific violations, permits, ECB, safety, or HPD records found.
              </p>
            )}

            {/* Explanation */}
            <p className="text-xs text-muted-foreground flex items-center gap-1 pt-2">
              <Info className="h-3 w-3" />
              Unit-level records are rare. Most NYC datasets are issued at the building level.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
