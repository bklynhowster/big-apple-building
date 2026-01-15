import { useState, useEffect } from 'react';
import { ExternalLink, DollarSign, FileText, Copy, Check, Info, Building2, Home, ChevronDown, ChevronUp, RefreshCw, AlertCircle, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePropertyTaxes, type ChargeRow, type Attempt } from '@/hooks/usePropertyTaxes';

interface TaxesCardProps {
  viewBbl: string;           // The unit BBL the user is viewing
  buildingBbl?: string;      // The parent building BBL (for condo units)
  address?: string;
  isUnitPage?: boolean;
}

// Parse BBL into borough, block, lot
function parseBBL(bbl: string): { borough: string; block: string; lot: string } | null {
  if (!bbl || bbl.length !== 10) return null;
  return {
    borough: bbl.charAt(0),
    block: bbl.slice(1, 6),
    lot: bbl.slice(6, 10),
  };
}

// Borough code to name mapping
const BOROUGH_NAMES: Record<string, string> = {
  '1': 'Manhattan',
  '2': 'Bronx',
  '3': 'Brooklyn',
  '4': 'Queens',
  '5': 'Staten Island',
};

// Format currency
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

// Format date
function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// Generate DOF CityPay URL (for current balance/charges)
function getDOFCityPayUrl(): string {
  return 'https://a836-citypay.nyc.gov/citypay/PropertyTax';
}

// Generate DOF Property Tax Bills URL
function getDOFBillsUrl(): string {
  return 'https://www.nyc.gov/site/finance/property/property-tax-bills-and-payments.page';
}

export function TaxesCard({ viewBbl, buildingBbl, address, isUnitPage = false }: TaxesCardProps) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attemptsOpen, setAttemptsOpen] = useState(false);
  
  const { loading, error, data, fetch, retry } = usePropertyTaxes();
  
  // Fetch tax data on mount or BBL change
  useEffect(() => {
    if (viewBbl && viewBbl.length === 10) {
      fetch(viewBbl, buildingBbl);
    }
  }, [viewBbl, buildingBbl, fetch]);
  
  const parsedBbl = parseBBL(viewBbl);
  const boroughName = parsedBbl ? BOROUGH_NAMES[parsedBbl.borough] : '';
  
  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setTimeout(() => setCopiedValue(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  const formatBblForDisplay = (bbl: string) => {
    const parsed = parseBBL(bbl);
    if (!parsed) return bbl;
    return `${parsed.borough}-${parsed.block}-${parsed.lot}`;
  };

  // Derive values from data
  const bblUsed = data?.bbl_used || viewBbl;
  const matchedField = data?.matched_field;
  const matchedKey = data?.matched_key;
  const isUsingBuildingLevel = data?.scope_used === 'building';
  const hasRealData = data && !data.no_data_found && data.rows_count > 0;
  const currentAmountOwed = data?.current_amount_owed;
  const attempts = data?.attempts || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Property Taxes</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {loading && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-sm">
                    Data from NYC DOF Property Charges Balance dataset. 
                    You may not receive a bill if taxes are paid through a bank or mortgage servicing company.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <CardDescription>
          NYC Department of Finance property tax account
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Loading State */}
        {loading && !data && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        )}
        
        {/* Error State */}
        {error && !data && (
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span className="text-sm">Failed to load tax data</span>
              <Button variant="ghost" size="sm" onClick={retry} className="h-6 px-2">
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        
        {/* Data Display */}
        {data && (
          <>
            {/* Amount Owed Summary */}
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Current Amount Owed</p>
                  {hasRealData && currentAmountOwed !== null ? (
                    <p className={`text-2xl font-bold ${currentAmountOwed > 0 ? 'text-destructive' : 'text-primary'}`}>
                      {formatCurrency(currentAmountOwed)}
                    </p>
                  ) : (
                    <p className="text-xl font-medium text-muted-foreground">
                      Not available
                    </p>
                  )}
                </div>
                {/* Only show badges when we have real data */}
                {hasRealData && currentAmountOwed !== null && (
                  <>
                    {currentAmountOwed === 0 && (
                      <Badge variant="secondary" className="bg-primary/10 text-primary">
                        Paid
                      </Badge>
                    )}
                    {currentAmountOwed > 0 && (
                      <Badge variant="destructive">
                        Balance Due
                      </Badge>
                    )}
                  </>
                )}
              </div>
              
              {/* Metadata - only show when we have real data */}
              {hasRealData && data.as_of && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>As of: {formatDate(data.as_of)}</span>
                </div>
              )}
            </div>
            
            {/* Scope and Match Indicator */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm flex-wrap">
                {isUsingBuildingLevel ? (
                  <>
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Account scope:</span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      Building
                    </Badge>
                  </>
                ) : (
                  <>
                    {isUnitPage ? (
                      <Home className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-muted-foreground">Account scope:</span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {isUnitPage ? 'Unit' : 'Property'}
                    </Badge>
                  </>
                )}
              </div>
              
              {/* Match indicator - only when we have data */}
              {hasRealData && matchedField && matchedKey && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Search className="h-3 w-3" />
                  <span>Matched using:</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                    {matchedField}='{matchedKey}'
                  </code>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {isUsingBuildingLevel ? 'building' : isUnitPage ? 'unit' : 'property'}
                  </Badge>
                </div>
              )}
            </div>
            
            {/* BBL display with copy button */}
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>BBL:</span>
                <code className="bg-muted px-1 rounded">{formatBblForDisplay(bblUsed)}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => handleCopy(bblUsed)}
                >
                  {copiedValue === bblUsed ? (
                    <Check className="h-3 w-3 text-primary" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </div>
            
            {/* Building level fallback note */}
            {isUsingBuildingLevel && isUnitPage && (
              <Alert className="py-2">
                <AlertDescription className="text-xs text-muted-foreground">
                  No unit-level tax account found. Showing building-level tax data.
                </AlertDescription>
              </Alert>
            )}
            
            {/* Details Collapsible - only when we have rows */}
            {hasRealData && data.recent_rows.length > 0 && (
              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between h-8 px-2">
                    <span className="text-xs text-muted-foreground">
                      View {data.recent_rows.length} charge records
                    </span>
                    {detailsOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 rounded border border-border overflow-hidden">
                    <div className="max-h-64 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Date</TableHead>
                            <TableHead className="text-xs">Type</TableHead>
                            <TableHead className="text-xs text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.recent_rows.map((item: ChargeRow, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell className="text-xs py-1.5">
                                {formatDate(item.stmtdate)}
                              </TableCell>
                              <TableCell className="text-xs py-1.5">
                                {item.chargetype || item.dession || '—'}
                              </TableCell>
                              <TableCell className={`text-xs py-1.5 text-right font-mono ${parseFloat(item.value || '0') < 0 ? 'text-primary' : ''}`}>
                                {formatCurrency(parseFloat(item.value || '0'))}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
            
            {/* No data found message */}
            {data.no_data_found && (
              <Alert className="py-2">
                <AlertDescription className="text-xs text-muted-foreground">
                  No NYC Open Data charge rows found after trying multiple identifier formats.
                </AlertDescription>
              </Alert>
            )}
            
            {/* Cache status debug info */}
            {data.cache_status && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${data.cache_status === 'HIT' ? 'bg-primary/10' : ''}`}>
                  Cache: {data.cache_status}
                </Badge>
                {data.cached_at && (
                  <span>Cached at: {formatDate(data.cached_at)}</span>
                )}
              </div>
            )}
            
            {/* Debug: Attempts list (collapsible) */}
            {attempts.length > 0 && (
              <Collapsible open={attemptsOpen} onOpenChange={setAttemptsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between h-7 px-2 text-muted-foreground">
                    <span className="text-[10px]">
                      {attempts.length} lookup attempts ({attempts.filter(a => a.rows_found > 0).length} matched)
                    </span>
                    {attemptsOpen ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1 rounded border border-border overflow-hidden">
                    <div className="max-h-40 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-[10px] py-1">Field</TableHead>
                            <TableHead className="text-[10px] py-1">Key</TableHead>
                            <TableHead className="text-[10px] py-1 text-right">Rows</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {attempts.map((attempt: Attempt, idx: number) => (
                            <TableRow key={idx} className={attempt.rows_found > 0 ? 'bg-primary/5' : ''}>
                              <TableCell className="text-[10px] py-1 font-mono">
                                {attempt.field}
                              </TableCell>
                              <TableCell className="text-[10px] py-1 font-mono max-w-[120px] truncate">
                                {attempt.key}
                              </TableCell>
                              <TableCell className={`text-[10px] py-1 text-right ${attempt.rows_found > 0 ? 'text-primary font-medium' : ''}`}>
                                {attempt.rows_found}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
        
        {/* Fallback: No data at all (before fetch completes) */}
        {!loading && !data && !error && (
          <Alert className="py-2">
            <AlertDescription className="text-xs text-muted-foreground">
              Tax data not available. Use the links below to check the official DOF portal.
            </AlertDescription>
          </Alert>
        )}
        
        {/* DOF External Links - Always shown as fallback */}
        <div className="grid gap-2 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground">Official NYC DOF portals:</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <a
              href={getDOFCityPayUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <div className="flex items-center justify-between p-2 rounded-md border border-border bg-muted/20 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  <span className="text-xs font-medium">Pay Taxes</span>
                </div>
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </div>
            </a>
            
            <a
              href={getDOFBillsUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <div className="flex items-center justify-between p-2 rounded-md border border-border bg-muted/20 hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-secondary-foreground" />
                  <span className="text-xs font-medium">View Bills</span>
                </div>
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </div>
            </a>
          </div>
        </div>
        
        {/* BBL Instruction for manual lookup */}
        {parsedBbl && (
          <div className="text-xs text-muted-foreground bg-muted/20 p-2 rounded">
            <p className="font-medium mb-1">To search on DOF sites:</p>
            <p className="font-mono text-xs">
              Borough: {boroughName} • Block: {parseInt(parsedBbl.block, 10)} • Lot: {parseInt(parsedBbl.lot, 10)}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
