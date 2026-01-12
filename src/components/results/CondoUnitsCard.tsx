import { useEffect, useState } from 'react';
import { Building2, ChevronRight, Info, ExternalLink, Loader2, AlertCircle, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCondoUnits, CondoUnit } from '@/hooks/useCondoUnits';

interface CondoUnitsCardProps {
  bbl: string;
  onContextChange?: (contextBbl: string, isUnit: boolean) => void;
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

function formatLot(lot: string): string {
  // Remove leading zeros for display
  return String(parseInt(lot, 10));
}

export function CondoUnitsCard({ bbl, onContextChange }: CondoUnitsCardProps) {
  const navigate = useNavigate();
  const { loading, error, data, fetch, retry } = useCondoUnits();
  const [isExpanded, setIsExpanded] = useState(false);
  const [displayCount, setDisplayCount] = useState(10);

  useEffect(() => {
    if (bbl && bbl.length === 10) {
      fetch(bbl);
    }
  }, [bbl, fetch]);

  if (loading) {
    return <LoadingSkeleton />;
  }

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
              <span>{error.userMessage || 'Failed to load condo information.'}</span>
              <Button variant="outline" size="sm" onClick={retry} className="ml-2">
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const handleOpenUnit = (unitBbl: string) => {
    // Navigate to the unit's results page
    const borough = unitBbl.substring(0, 1);
    const boroughName = {
      '1': 'Manhattan',
      '2': 'Bronx',
      '3': 'Brooklyn',
      '4': 'Queens',
      '5': 'Staten Island',
    }[borough] || 'Unknown';
    
    navigate(`/results?bbl=${unitBbl}&borough=${encodeURIComponent(boroughName)}`);
  };

  const handleContextSwitch = (contextBbl: string, isUnit: boolean) => {
    if (onContextChange) {
      onContextChange(contextBbl, isUnit);
    }
  };

  // Non-condo property
  if (!data.isCondo) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Tax Lot Structure
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Not a Condominium</p>
              <p className="text-sm text-muted-foreground">
                This property is not classified as a condominium. Multifamily rental buildings typically have a single BBL with multiple residential units, not separate tax lots per apartment.
              </p>
              {data.notes.length > 0 && (
                <ul className="text-xs text-muted-foreground list-disc ml-4 mt-2">
                  {data.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Condo property with units
  const displayedUnits = data.units.slice(0, displayCount);
  const hasMoreUnits = data.units.length > displayCount;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Condo Units
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            Condominium
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Condo Info Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Unit Lots</p>
            <p className="text-lg font-semibold">{data.units.length}</p>
          </div>
          {data.condoId && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Condo ID</p>
              <p className="text-sm font-medium font-mono">{data.condoId}</p>
            </div>
          )}
          {data.buildingContextBbl && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Building BBL</p>
              <p className="text-sm font-medium font-mono">{data.buildingContextBbl}</p>
            </div>
          )}
          {data.billingLotBbl && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Billing Lot</p>
              <p className="text-sm font-medium font-mono">{data.billingLotBbl}</p>
            </div>
          )}
        </div>

        {/* Notes */}
        {data.notes.length > 0 && (
          <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
            {data.notes.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
          </div>
        )}

        {/* Unit Lots */}
        {data.units.length === 0 ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Condominium detected, but individual unit lots could not be enumerated from available data sources. This BBL may itself be a unit lot.
            </AlertDescription>
          </Alert>
        ) : (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Unit Tax Lots ({data.units.length})</p>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {isExpanded ? 'Hide Units' : 'Show Units'}
                  <ChevronRight className={`h-4 w-4 ml-1 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
            
            <CollapsibleContent>
              <div className="mt-3 border rounded-md">
                <ScrollArea className={data.units.length > 10 ? 'h-80' : undefined}>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="font-semibold">Unit BBL</TableHead>
                        <TableHead className="font-semibold">Lot</TableHead>
                        <TableHead className="font-semibold">Unit Label</TableHead>
                        <TableHead className="font-semibold text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayedUnits.map((unit, i) => (
                        <TableRow key={unit.unitBbl || i}>
                          <TableCell className="font-mono text-sm">{unit.unitBbl}</TableCell>
                          <TableCell className="text-sm">{formatLot(unit.lot)}</TableCell>
                          <TableCell className="text-sm">{unit.unitLabel || '-'}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenUnit(unit.unitBbl)}
                              className="gap-1"
                            >
                              <Home className="h-3.5 w-3.5" />
                              Open
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                
                {hasMoreUnits && (
                  <div className="p-2 border-t text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDisplayCount(prev => prev + 20)}
                    >
                      Load more ({data.units.length - displayCount} remaining)
                    </Button>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Context Switch Controls */}
        {data.units.length > 0 && onContextChange && (
          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleContextSwitch(data.buildingContextBbl || bbl, false)}
              className="gap-1.5"
            >
              <Building2 className="h-3.5 w-3.5" />
              Building Context
            </Button>
            <span className="text-xs text-muted-foreground self-center">
              Use building BBL for violations/permits that apply to the whole building
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
