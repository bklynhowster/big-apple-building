import React from 'react';
import { Building2, DollarSign, Info, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PropertyTaxResult } from '@/features/taxes/types';

interface UnitOverviewCardProps {
  /** Unit label (e.g., "2E") */
  unitLabel: string | null;
  /** Unit BBL (10 digits) */
  unitBbl: string;
  /** Lot number from condo roster (optional) */
  lotNumber?: string | null;
  /** Tax data for the unit */
  taxData: PropertyTaxResult | null;
  /** Whether tax data is loading */
  taxLoading: boolean;
  /** Tax fetch error message */
  taxError: string | null;
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

type TaxRiskLevel = 'safe' | 'attention' | 'risk' | 'unknown';

interface TaxStatusInfo {
  label: string;
  riskLevel: TaxRiskLevel;
}

function getTaxStatusInfo(
  status: string | undefined, 
  arrears: number | null | undefined
): TaxStatusInfo {
  const hasArrears = arrears !== null && arrears !== undefined && arrears > 0;
  
  if (status === 'paid') {
    return { label: 'Paid', riskLevel: 'safe' };
  }
  if (status === 'unpaid') {
    if (hasArrears) {
      return { label: 'Unpaid — arrears present', riskLevel: 'risk' };
    }
    return { label: 'Unpaid — no arrears', riskLevel: 'attention' };
  }
  return { label: 'Unknown', riskLevel: 'unknown' };
}

const taxStatusClasses: Record<TaxRiskLevel, string> = {
  safe: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-300 dark:border-green-700',
  attention: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300 dark:border-amber-700',
  risk: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-300 dark:border-red-700',
  unknown: 'bg-muted text-muted-foreground border-border',
};

export function UnitOverviewCard({
  unitLabel,
  unitBbl,
  lotNumber,
  taxData,
  taxLoading,
  taxError,
}: UnitOverviewCardProps) {
  // Extract lot from BBL if not provided
  const displayLot = lotNumber || (unitBbl.length === 10 ? unitBbl.slice(6).replace(/^0+/, '') : null);

  return (
    <Card className="border-primary/30 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-primary/10 rounded-lg">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-lg">Unit Overview</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Unit Identity */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            Unit Identity
          </h4>
          <div className="flex flex-wrap gap-2">
            {unitLabel && (
              <Badge variant="secondary" className="text-sm font-mono">
                Unit {unitLabel}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
              BBL: {unitBbl}
            </Badge>
            {displayLot && (
              <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
                Lot: {displayLot}
              </Badge>
            )}
          </div>
        </div>

        {/* Unit Tax Snapshot */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <DollarSign className="h-3.5 w-3.5" />
            Unit Tax Snapshot
          </h4>
          
          {taxLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading tax data...</span>
            </div>
          ) : taxError ? (
            <p className="text-sm text-destructive">{taxError}</p>
          ) : taxData?.no_data_found ? (
            <p className="text-sm text-muted-foreground">No unit tax bill found.</p>
          ) : taxData ? (
            <div className="flex flex-col gap-3">
              {/* Tax Status - Primary / First-class signal */}
              {(() => {
                const statusInfo = getTaxStatusInfo(taxData.payment_status, taxData.arrears);
                return (
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-foreground">Tax Status</span>
                    <div>
                      <span 
                        className={cn(
                          "inline-flex items-center px-3 py-1.5 rounded-md text-sm font-semibold border",
                          taxStatusClasses[statusInfo.riskLevel]
                        )}
                      >
                        {statusInfo.label}
                      </span>
                    </div>
                  </div>
                );
              })()}
              
              {/* Secondary info row - de-emphasized */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* Latest Bill - Secondary emphasis */}
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground/70">Latest Bill</span>
                  <p className="text-sm font-medium">{formatCurrency(taxData.latest_bill_amount)}</p>
                </div>
                
                {/* Due Date - Tertiary emphasis */}
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground/70">Due Date</span>
                  <p className="text-xs text-muted-foreground">{formatDate(taxData.latest_due_date)}</p>
                </div>
                
                {/* Arrears - Only show if present */}
                {taxData.arrears && taxData.arrears > 0 && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground/70">Arrears</span>
                    <p className="text-sm font-semibold text-destructive">
                      {formatCurrency(taxData.arrears)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No unit tax bill found.</p>
          )}
        </div>

        {/* Scope Note */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Most NYC enforcement datasets are building-level; this unit view highlights unit taxes 
              and any record text that mentions this unit.
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
