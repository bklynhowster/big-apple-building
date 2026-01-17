import React from 'react';
import { Building2, DollarSign, FileSearch, Info, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  /** Count of inferred unit mentions from building records */
  mentionCount: number;
  /** Whether mention data is still loading */
  mentionsLoading: boolean;
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

function getPaymentStatusVariant(status: string | undefined): 'default' | 'destructive' | 'secondary' {
  if (status === 'paid') return 'default';
  if (status === 'unpaid') return 'destructive';
  return 'secondary';
}

function getPaymentStatusLabel(status: string | undefined): string {
  if (status === 'paid') return 'Paid';
  if (status === 'unpaid') return 'Unpaid';
  return 'Unknown';
}

export function UnitOverviewCard({
  unitLabel,
  unitBbl,
  lotNumber,
  taxData,
  taxLoading,
  taxError,
  mentionCount,
  mentionsLoading,
}: UnitOverviewCardProps) {
  // Extract lot from BBL if not provided
  const displayLot = lotNumber || (unitBbl.length === 10 ? unitBbl.slice(6).replace(/^0+/, '') : null);

  return (
    <Card className="border-primary/30 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 bg-primary/10 rounded-lg">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <CardTitle className="text-lg">Unit Overview</CardTitle>
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
            <Badge variant="outline" className="text-sm font-mono">
              BBL: {unitBbl}
            </Badge>
            {displayLot && (
              <Badge variant="outline" className="text-sm font-mono">
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Latest Bill */}
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Latest Bill</span>
                <p className="text-sm font-medium">{formatCurrency(taxData.latest_bill_amount)}</p>
              </div>
              
              {/* Due Date */}
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Due Date</span>
                <p className="text-sm font-medium">{formatDate(taxData.latest_due_date)}</p>
              </div>
              
              {/* Status */}
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Status</span>
                <Badge 
                  variant={getPaymentStatusVariant(taxData.payment_status)}
                  className="text-xs"
                >
                  {getPaymentStatusLabel(taxData.payment_status)}
                </Badge>
              </div>
              
              {/* Arrears */}
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Arrears</span>
                <p className={`text-sm font-medium ${
                  taxData.arrears && taxData.arrears > 0 ? 'text-destructive' : ''
                }`}>
                  {taxData.arrears && taxData.arrears > 0 
                    ? formatCurrency(taxData.arrears)
                    : 'None'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No unit tax bill found.</p>
          )}
        </div>

        {/* Unit Mentions */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <FileSearch className="h-3.5 w-3.5" />
            Unit Mentions
          </h4>
          
          {mentionsLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : mentionCount > 0 ? (
            <p className="text-sm">
              <span className="font-medium">{mentionCount}</span>
              {' '}inferred mention{mentionCount !== 1 ? 's' : ''} found in building records
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No unit mentions found in building records.
            </p>
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
