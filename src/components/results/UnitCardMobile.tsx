import { memo } from 'react';
import { Home, Info, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { CondoUnit } from '@/hooks/useCondoUnits';
import type { CondoUnitTaxSummary } from '@/features/taxes/types';
import {
  formatUSDForTable,
  formatDate,
  formatLot,
  getPaymentStatusInfo,
} from '@/features/taxes';

interface UnitCardMobileProps {
  unit: CondoUnit;
  taxSummary: CondoUnitTaxSummary | null;
  isCurrent: boolean;
  isBuilding: boolean;
  onOpenUnit: (unitBbl: string) => void;
}

export const UnitCardMobile = memo(function UnitCardMobile({
  unit,
  taxSummary,
  isCurrent,
  isBuilding,
  onOpenUnit,
}: UnitCardMobileProps) {
  const displayLabel = unit.unitLabel || `Lot ${formatLot(unit.lot)}`;
  const labelSource = unit.unitLabelSource || 'unknown';
  const isLotFallback = !unit.unitLabel || labelSource === 'fallback.lot';

  const statusInfo = taxSummary?.data
    ? getPaymentStatusInfo(taxSummary.data.payment_status)
    : null;
  const hasArrears =
    taxSummary?.data?.arrears !== null &&
    taxSummary?.data?.arrears !== undefined &&
    taxSummary.data.arrears > 0;

  return (
    <Card className={isCurrent ? 'border-primary/50 bg-muted/40' : ''}>
      <CardContent className="p-4 space-y-3">
        {/* Header row: unit label + status badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="font-medium text-base cursor-help flex items-center gap-1">
                      <span className={isLotFallback ? 'text-muted-foreground' : ''}>
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
                    <p className="text-xs text-muted-foreground">Lot: {formatLot(unit.lot)}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {isCurrent && (
                <Badge variant="secondary" className="text-[10px]">
                  Current
                </Badge>
              )}
            </div>
            <span className="font-mono text-xs text-muted-foreground truncate">
              {unit.unitBbl}
            </span>
          </div>

          {/* Status badge */}
          {isBuilding && (
            <div className="flex-shrink-0">
              {taxSummary?.loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : taxSummary?.error ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="destructive" className="text-xs gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Error
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{taxSummary.error}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : statusInfo ? (
                <Badge
                  variant={statusInfo.variant as 'default' | 'secondary' | 'destructive' | 'outline'}
                  className="text-xs gap-1"
                >
                  {statusInfo.icon}
                  {statusInfo.label}
                </Badge>
              ) : taxSummary?.data?.no_data_found ? (
                <Badge variant="outline" className="text-xs">
                  No bill
                </Badge>
              ) : null}
            </div>
          )}
        </div>

        {/* Tax details - only on building pages */}
        {isBuilding && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {/* Latest Bill */}
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Latest Bill</p>
              {taxSummary?.loading ? (
                <span className="text-muted-foreground text-xs italic">Loading…</span>
              ) : taxSummary?.error ? (
                <span className="text-destructive text-xs">—</span>
              ) : taxSummary?.data?.no_data_found ? (
                <span className="text-muted-foreground text-xs">No bill found</span>
              ) : taxSummary?.data ? (
                <span className="font-medium">
                  {formatUSDForTable(taxSummary.data.latest_bill_amount)}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </div>

            {/* Due Date */}
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Due Date</p>
              {taxSummary?.loading ? (
                <span className="text-muted-foreground text-xs italic">—</span>
              ) : taxSummary?.data?.latest_due_date ? (
                <span className="text-muted-foreground">
                  {formatDate(taxSummary.data.latest_due_date)}
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </div>

            {/* Arrears */}
            {hasArrears && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-0.5">Arrears</p>
                <Badge variant="destructive" className="text-xs">
                  {formatUSDForTable(taxSummary?.data?.arrears)}
                </Badge>
              </div>
            )}
          </div>
        )}

        {/* Action button - large tap target */}
        <Button
          variant="outline"
          size="default"
          onClick={() => onOpenUnit(unit.unitBbl)}
          className="w-full min-h-[44px] gap-2"
        >
          <Home className="h-4 w-4" />
          Open unit
        </Button>
      </CardContent>
    </Card>
  );
});
