import { useEffect, useMemo, useState } from 'react';
import { Building2, Home, Search, ArrowLeft, AlertCircle, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useCondoUnits } from '@/hooks/useCondoUnits';

interface CondoUnitsCardProps {
  bbl: string;
  onUnitLabelResolved?: (unitLabel: string | null) => void;
  onBillingBblResolved?: (billingBbl: string) => void;
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

export function CondoUnitsCard({ bbl, onUnitLabelResolved, onBillingBblResolved }: CondoUnitsCardProps) {
  const navigate = useNavigate();
  const { loading, loadingMore, error, data, fetchFirstPage, fetchNextPage, retry } = useCondoUnits();
  const [searchQuery, setSearchQuery] = useState('');

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

  useEffect(() => {
    if (bbl && bbl.length === 10) {
      fetchFirstPage(bbl, 2000);
    }
  }, [bbl, fetchFirstPage]);

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

  const currentUnitBbl = data?.inputRole === 'unit' ? data.inputBbl : null;

  const handleOpenUnit = (unitBbl: string) => {
    navigate(`/results?bbl=${unitBbl}&borough=${encodeURIComponent(boroughNameFromBbl(unitBbl))}`);
  };

  const handleBackToBuilding = () => {
    if (!data?.billingBbl) return;
    navigate(`/results?bbl=${data.billingBbl}&borough=${encodeURIComponent(boroughNameFromBbl(data.billingBbl))}`);
  };

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Condo Units
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>{error.userMessage || 'Failed to load condo units.'}</span>
              <Button variant="outline" size="sm" onClick={retry} className="ml-2">
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // Visible when the property is a condo OR the lot looks like a condo billing lot (75xx).
  if (!data.isCondo && !lotLooksLikeBilling) return null;

  const hasMore = data.totalApprox > 0 ? data.units.length < data.totalApprox : false;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Condo Units
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {data.isCondo ? 'Condominium' : 'Possible condo'}
            </Badge>
            {data.strategyUsed === 'blockLotFallback' && (
              <Badge variant="outline" className="text-xs">
                Units found via block-based condo fallback
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Unit count found</p>
            <Badge variant="outline" className="font-mono">
              {data.totalApprox || data.units.length}
            </Badge>
          </div>

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
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by unit label, lot, or BBL…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <div className="border rounded-md">
          <ScrollArea className={filteredUnits.length > 10 ? 'h-80' : undefined}>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Unit label</TableHead>
                  <TableHead className="font-semibold">Unit BBL</TableHead>
                  <TableHead className="font-semibold">Lot</TableHead>
                  <TableHead className="font-semibold text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUnits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">
                      {data.units.length === 0
                        ? 'Condo detected but 0 unit lots returned from unit dataset. Check logs for dataset + filter.'
                        : 'No units match your search.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUnits.map((unit) => {
                    const isCurrent = Boolean(currentUnitBbl && unit.unitBbl === currentUnitBbl);
                    const displayLabel = unit.unitLabel || `Lot ${formatLot(unit.lot)}`;
                    const labelSource = unit.unitLabelSource || 'unknown';
                    const isLotFallback = !unit.unitLabel || labelSource === 'fallback.lot';

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

          {hasMore && (
            <div className="p-2 border-t text-center">
              <Button variant="ghost" size="sm" onClick={() => fetchNextPage()} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Load more (${data.totalApprox - data.units.length} remaining)`}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
