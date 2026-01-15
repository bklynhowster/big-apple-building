import { useState, useEffect } from 'react';
import { ExternalLink, DollarSign, Copy, Check, Info, ChevronDown, ChevronUp, RefreshCw, AlertCircle, Bug, Calendar, Receipt, HelpCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { usePropertyTaxes, type DebugInfo, type TaxBasis, type TaxConfidence } from '@/hooks/usePropertyTaxes';

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

// Get tooltip text based on basis
function getBasisTooltip(basis: TaxBasis): string {
  switch (basis) {
    case 'dof_assessment':
      return 'Derived from NYC DOF tax assessment inputs.';
    case 'pluto_estimate':
      return 'Estimate derived from assessed value; may differ from official DOF bill.';
    case 'unavailable':
      return 'Assessment/tax data not available for this parcel from public datasets.';
    default:
      return '';
  }
}

// Get confidence badge variant
function getConfidenceBadge(confidence: TaxConfidence, basis: TaxBasis): { label: string; variant: 'default' | 'secondary' | 'outline' } | null {
  switch (confidence) {
    case 'high':
      return { label: 'DOF Assessment', variant: 'default' };
    case 'estimated':
      return { label: 'Estimated', variant: 'secondary' };
    case 'none':
      return null;
    default:
      return null;
  }
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
  const billingCycle = data?.billing_cycle;
  const dueDateFormatted = data?.due_date_formatted;
  const taxClass = data?.tax_class;
  const basis = data?.basis;
  const confidence = data?.confidence;
  const basisExplanation = data?.basis_explanation;
  const arrearsStatus = data?.arrears_status;
  const arrearsNote = data?.arrears_note;
  
  const confidenceBadge = confidence && basis ? getConfidenceBadge(confidence, basis) : null;

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
                    {basis ? getBasisTooltip(basis) : 'NYC property tax information.'}
                    {' '}You may not receive a bill if taxes are paid through a bank or mortgage servicing company.
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
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">
                      Latest Quarterly Property Tax Bill
                    </p>
                    {/* Info tooltip for basis */}
                    {basis && basis !== 'unavailable' && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-xs">{basisExplanation}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  {quarterlyBill !== null ? (
                    <p className="text-2xl font-bold text-foreground">
                      {formatCurrency(quarterlyBill)}
                    </p>
                  ) : (
                    <p className="text-xl font-medium text-muted-foreground">
                      Unavailable
                    </p>
                  )}
                </div>
                {confidenceBadge && (
                  <Badge variant={confidenceBadge.variant} className="text-xs">
                    {confidenceBadge.label}
                  </Badge>
                )}
              </div>
              
              {/* Due Date */}
              {dueDateFormatted && quarterlyBill !== null && (
                <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Due: {dueDateFormatted}</span>
                </div>
              )}
              
              {/* Unavailable reason */}
              {basis === 'unavailable' && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Assessment/tax data not available for this parcel from public datasets.
                </p>
              )}
            </div>
            
            {/* Secondary Info: Annual Tax and Billing Cycle */}
            {annualTax !== null && (
              <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  <span>Annual property tax: {formatCurrency(annualTax)}</span>
                </div>
                {taxClass && billingCycle && (
                  <span className="ml-6">Billing cycle: {billingCycle} (NYC Tax Class {taxClass})</span>
                )}
              </div>
            )}
            
            {/* Arrears Status */}
            <div className="flex items-center gap-2 text-sm">
              {arrearsStatus === 'none_detected' && (
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  Arrears: None detected
                </Badge>
              )}
              {arrearsStatus === 'unavailable' && (
                <Badge variant="secondary" className="text-muted-foreground">
                  Arrears: Unavailable
                </Badge>
              )}
              {arrearsNote && arrearsStatus === 'unavailable' && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">{arrearsNote}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
            {data.taxable_billable_av !== null && (
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
                    {data.assessed_value !== null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Assessed Total Value:</span>
                        <span className="font-mono">{formatCurrency(data.assessed_value)}</span>
                      </div>
                    )}
                    {data.exempt_value !== null && data.exempt_value > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Exempt Value:</span>
                        <span className="font-mono">{formatCurrency(data.exempt_value)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-2">
                      <span className="text-muted-foreground font-medium">Taxable Billable AV:</span>
                      <span className="font-mono font-medium">{formatCurrency(data.taxable_billable_av)}</span>
                    </div>
                    {data.tax_rate !== null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tax Rate:</span>
                        <span className="font-mono">{(data.tax_rate * 100).toFixed(3)}%</span>
                      </div>
                    )}
                    {data.tax_rate_description && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tax Class:</span>
                        <span>{data.tax_rate_description}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[10px] text-muted-foreground/70 pt-1">
                      <span>Source:</span>
                      <span>{data.data_source}</span>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
            
            {/* No data found message */}
            {data.no_data_found && (
              <Alert className="py-2">
                <AlertDescription className="text-xs text-muted-foreground">
                  No assessment data found for this property in public datasets.
                </AlertDescription>
              </Alert>
            )}
            
            {/* Cache status */}
            {data.cache_status && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${data.cache_status === 'HIT' ? 'bg-primary/10' : ''}`}>
                  Cache: {data.cache_status}
                </Badge>
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
                    {/* Step Results */}
                    <div className="space-y-2">
                      <p className="font-medium text-amber-700 dark:text-amber-400">Data Strategy Steps:</p>
                      <div className="bg-muted p-2 rounded space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={data.debug.step1_success ? 'text-green-600' : 'text-red-500'}>
                            {data.debug.step1_success ? '✓' : '✗'}
                          </span>
                          <span>Step 1 (DOF Assessment): {data.debug.step1_success ? 'Success' : 'Failed'}</span>
                        </div>
                        {data.debug.step1_url && (
                          <code className="block text-[10px] break-all ml-5 text-muted-foreground">{data.debug.step1_url}</code>
                        )}
                        {data.debug.step2_attempted && (
                          <>
                            <div className="flex items-center gap-2">
                              <span className={data.debug.step2_success ? 'text-green-600' : 'text-red-500'}>
                                {data.debug.step2_success ? '✓' : '✗'}
                              </span>
                              <span>Step 2 (PLUTO Fallback): {data.debug.step2_success ? 'Success' : 'Failed'}</span>
                            </div>
                            {data.debug.step2_url && (
                              <code className="block text-[10px] break-all ml-5 text-muted-foreground">{data.debug.step2_url}</code>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/* Calculation Steps */}
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Calculation Steps:</p>
                      <div className="bg-muted p-2 rounded space-y-1 max-h-48 overflow-auto">
                        {data.debug.calculation_steps.map((step, idx) => (
                          <div key={idx} className="text-[10px] font-mono">{step}</div>
                        ))}
                      </div>
                    </div>
                    
                    {/* DOF Row Keys */}
                    {data.debug.dof_row_keys.length > 0 && (
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
                          DOF Row Keys ({data.debug.dof_row_keys.length}):
                        </p>
                        <code className="block bg-muted p-2 rounded text-[10px] break-all">
                          {data.debug.dof_row_keys.join(', ')}
                        </code>
                      </div>
                    )}
                    
                    {/* PLUTO Row Keys */}
                    {data.debug.pluto_row_keys.length > 0 && (
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
                          PLUTO Row Keys ({data.debug.pluto_row_keys.length}):
                        </p>
                        <code className="block bg-muted p-2 rounded text-[10px] break-all">
                          {data.debug.pluto_row_keys.join(', ')}
                        </code>
                      </div>
                    )}
                    
                    {/* Raw DOF Row */}
                    {data.debug.raw_dof_row && (
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Raw DOF Row:</p>
                        <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-48">
                          {JSON.stringify(data.debug.raw_dof_row, null, 2)}
                        </pre>
                      </div>
                    )}
                    
                    {/* Raw PLUTO Row */}
                    {data.debug.raw_pluto_row && (
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Raw PLUTO Row:</p>
                        <pre className="bg-muted p-2 rounded text-[10px] overflow-auto max-h-48">
                          {JSON.stringify(data.debug.raw_pluto_row, null, 2)}
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
