import { useState, useEffect } from 'react';
import { ExternalLink, DollarSign, Copy, Check, Info, Building2, Home, ChevronDown, ChevronUp, RefreshCw, AlertCircle, HelpCircle, Bug, Calendar, Receipt } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { usePropertyTaxes, type DebugInfo } from '@/hooks/usePropertyTaxes';

interface TaxesCardProps {
  viewBbl: string;
  buildingBbl?: string;
  address?: string;
  isUnitPage?: boolean;
}

function parseBBL(bbl: string): { borough: string; block: string; lot: string } | null {
  if (!bbl || bbl.length !== 10) return null;
  return {
    borough: bbl.charAt(0),
    block: bbl.slice(1, 6),
    lot: bbl.slice(6, 10),
  };
}

const BOROUGH_NAMES: Record<string, string> = {
  '1': 'Manhattan',
  '2': 'Bronx',
  '3': 'Brooklyn',
  '4': 'Queens',
  '5': 'Staten Island',
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function getDOFCityPayUrl(): string {
  return 'https://a836-citypay.nyc.gov/citypay/PropertyTax';
}

function getDOFBillsUrl(): string {
  return 'https://www.nyc.gov/site/finance/property/property-tax-bills-and-payments.page';
}

export function TaxesCard({ viewBbl, buildingBbl, address, isUnitPage = false }: TaxesCardProps) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  
  // Check if debug mode via URL query param
  const isDebugMode = typeof window !== 'undefined' && 
    (new URLSearchParams(window.location.search).get('debugTaxes') === '1');
  
  const { loading, error, data, fetch, retry } = usePropertyTaxes();
  
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
  const quarterlyBill = data?.quarterly_bill;
  const annualTax = data?.annual_tax;
  const billingPeriod = data?.billing_period;
  const dueDateFormatted = data?.due_date_formatted;
  const taxClass = data?.tax_class;
  const taxRateDescription = data?.tax_rate_description;
  const arrearsStatus = data?.arrears_status;
  const arrearsNote = data?.arrears_note;

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
                    Quarterly tax bill calculated from NYC assessment data. 
                    You may not receive a bill if taxes are paid through a bank or mortgage servicing company.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        <CardDescription>
          NYC Department of Finance property tax
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
            {/* Primary: Latest Quarterly Property Tax Bill */}
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Latest Quarterly Property Tax Bill
                  </p>
                  {quarterlyBill !== null ? (
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(quarterlyBill)}
                    </p>
                  ) : (
                    <p className="text-xl font-medium text-muted-foreground">
                      Not available
                    </p>
                  )}
                </div>
                {billingPeriod && (
                  <Badge variant="secondary" className="text-xs">
                    {billingPeriod}
                  </Badge>
                )}
              </div>
              
              {/* Due Date */}
              {dueDateFormatted && quarterlyBill !== null && (
                <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Due {dueDateFormatted}</span>
                </div>
              )}
            </div>
            
            {/* Secondary Info: Annual Tax and Billing Cycle */}
            {annualTax !== null && (
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  <span>Annual property tax: {formatCurrency(annualTax)}</span>
                </div>
                {taxClass && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    <span>Billing cycle: Quarterly (NYC Tax Class {taxClass})</span>
                  </div>
                )}
              </div>
            )}
            
            {/* Arrears Status */}
            <div className="flex items-center gap-2 text-sm">
              {arrearsStatus === 'none_detected' && (
                <>
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                    Arrears: None detected
                  </Badge>
                </>
              )}
              {arrearsStatus === 'possible' && (
                <Badge variant="destructive">
                  Arrears: Possible
                </Badge>
              )}
              {arrearsStatus === 'unknown' && (
                <Badge variant="secondary">
                  Arrears: Unknown
                </Badge>
              )}
              {arrearsNote && (
                <span className="text-xs text-muted-foreground">{arrearsNote}</span>
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
            
            {/* Assessment Details Collapsible */}
            {data.assessed_value !== null && (
              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between h-8 px-2">
                    <span className="text-xs text-muted-foreground">
                      View assessment details
                    </span>
                    {detailsOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 rounded border border-border p-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Assessed Total Value:</span>
                      <span className="font-mono">{data.assessed_value !== null ? formatCurrency(data.assessed_value) : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Exempt Value:</span>
                      <span className="font-mono">{data.exempt_value !== null ? formatCurrency(data.exempt_value) : '—'}</span>
                    </div>
                    <div className="flex justify-between border-t pt-2">
                      <span className="text-muted-foreground font-medium">Taxable Billable AV:</span>
                      <span className="font-mono font-medium">{data.taxable_value !== null ? formatCurrency(data.taxable_value) : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax Rate:</span>
                      <span className="font-mono">{data.tax_rate !== null ? `${(data.tax_rate * 100).toFixed(3)}%` : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax Class:</span>
                      <span>{taxRateDescription || '—'}</span>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
            
            {/* No data found message */}
            {data.no_data_found && (
              <Alert className="py-2">
                <AlertDescription className="text-xs text-muted-foreground">
                  No NYC PLUTO assessment data found for this property. Tax calculation unavailable.
                </AlertDescription>
              </Alert>
            )}
            
            {/* Cache status */}
            {data.cache_status && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${data.cache_status === 'HIT' ? 'bg-primary/10' : ''}`}>
                  Cache: {data.cache_status}
                </Badge>
                <span className="text-muted-foreground/70">Source: {data.data_source}</span>
              </div>
            )}
            
            {/* Debug Panel - only visible when ?debugTaxes=1 */}
            {isDebugMode && data.debug && (
              <Collapsible open={debugOpen} onOpenChange={setDebugOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between h-8 px-2 border-amber-500/50 bg-amber-500/10">
                    <div className="flex items-center gap-2">
                      <Bug className="h-3 w-3 text-amber-600" />
                      <span className="text-xs text-amber-700 dark:text-amber-400">Debug Info</span>
                    </div>
                    {debugOpen ? (
                      <ChevronUp className="h-4 w-4 text-amber-600" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-amber-600" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 space-y-3 p-3 rounded border border-amber-500/30 bg-amber-500/5 text-xs">
                    {/* PLUTO URL */}
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">PLUTO Request URL:</p>
                      <code className="block bg-muted p-2 rounded text-[10px] break-all">
                        {data.debug.pluto_request_url || 'N/A'}
                      </code>
                    </div>
                    
                    {/* Calculation Steps */}
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Calculation Steps:</p>
                      <div className="bg-muted p-2 rounded space-y-1">
                        {data.debug.calculation_steps.map((step, idx) => (
                          <div key={idx} className="text-[10px] font-mono">{step}</div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Raw Row Keys */}
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
                        PLUTO Row Keys ({data.debug.raw_row_keys.length}):
                      </p>
                      <code className="block bg-muted p-2 rounded text-[10px] break-all">
                        {data.debug.raw_row_keys.join(', ') || 'None'}
                      </code>
                    </div>
                    
                    {/* Raw Row JSON */}
                    {data.debug.raw_row && (
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Raw PLUTO Row:</p>
                        <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-48">
                          {JSON.stringify(data.debug.raw_row, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
            
            {/* External Links */}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
                <a href={getDOFCityPayUrl()} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1.5" />
                  Pay on CityPay
                </a>
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
                <a href={getDOFBillsUrl()} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1.5" />
                  View Official Bills
                </a>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
