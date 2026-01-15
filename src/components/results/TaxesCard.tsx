import { useState, useEffect } from 'react';
import { ExternalLink, DollarSign, Copy, Check, Info, ChevronDown, ChevronUp, RefreshCw, AlertCircle, Bug, Calendar, HelpCircle, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { usePropertyTaxes, type DebugInfo, type PaymentStatus, type BillingCycle } from '@/hooks/usePropertyTaxes';

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

// Safe USD formatter - never returns $NaN
function formatUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'Unavailable';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function getDOFCityPayUrl(): string {
  return 'https://a836-citypay.nyc.gov/citypay/PropertyTax';
}

function getDOFBillsUrl(): string {
  return 'https://www.nyc.gov/site/finance/property/property-tax-bills-and-payments.page';
}

// Get payment status badge
function getPaymentStatusBadge(status: PaymentStatus): { label: string; variant: 'default' | 'destructive' | 'secondary'; icon: React.ReactNode } | null {
  switch (status) {
    case 'paid':
      return { label: 'Paid', variant: 'default', icon: <CheckCircle2 className="h-3 w-3 mr-1" /> };
    case 'unpaid':
      return { label: 'Unpaid', variant: 'destructive', icon: <XCircle className="h-3 w-3 mr-1" /> };
    case 'unknown':
      return { label: 'Status Unknown', variant: 'secondary', icon: <Clock className="h-3 w-3 mr-1" /> };
    default:
      return null;
  }
}

export function TaxesCard({ viewBbl, buildingBbl, address, isUnitPage = false }: TaxesCardProps) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
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
  const latestBillAmount = data?.latest_bill_amount;
  const latestDueDate = data?.latest_due_date;
  const billingCycle = data?.billing_cycle;
  const paymentStatus = data?.payment_status;
  const arrears = data?.arrears;
  const arrearsAvailable = data?.arrears_available;
  const arrearsNote = data?.arrears_note;
  
  const statusBadge = paymentStatus ? getPaymentStatusBadge(paymentStatus) : null;

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
                    Tax bill data from NYC DOF public ledger records.
                    Amounts shown are estimates based on available data.
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
            {/* Primary: Latest Bill Amount (public ledger) */}
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Latest Bill Amount
                    <span className="normal-case ml-1 opacity-70">(public ledger)</span>
                  </p>
                  {latestBillAmount !== null && Number.isFinite(latestBillAmount) ? (
                    <p className="text-2xl font-bold text-foreground">
                      {formatUSD(latestBillAmount)}
                    </p>
                  ) : (
                    <div>
                      <p className="text-xl font-medium text-muted-foreground">
                        Unavailable
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        No bill rows found in public ledger data for this parcel.
                      </p>
                    </div>
                  )}
                </div>
                {statusBadge && (
                  <Badge variant={statusBadge.variant} className="text-xs flex items-center">
                    {statusBadge.icon}
                    {statusBadge.label}
                  </Badge>
                )}
              </div>
              
              {/* Due Date */}
              {latestDueDate && latestBillAmount !== null && (
                <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>Due date: {latestDueDate}</span>
                </div>
              )}
              
              {/* Billing Cycle */}
              {billingCycle && billingCycle !== 'Unknown' && (
                <div className="mt-1 text-sm text-muted-foreground">
                  <span>Billing cycle: {billingCycle}</span>
                </div>
              )}
            </div>
            
            {/* Arrears Status (public ledger estimate) */}
            <div className="flex items-center gap-2 text-sm">
              {arrearsAvailable ? (
                arrears !== null && Number.isFinite(arrears) && arrears > 0 ? (
                  <Badge variant="destructive" className="text-xs">
                    Arrears (estimate): {formatUSD(arrears)}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-xs">
                    No arrears detected
                  </Badge>
                )
              ) : (
                <Badge variant="secondary" className="text-xs">
                  Arrears: Unavailable
                </Badge>
              )}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">
                      {arrearsNote || 'Arrears estimate based on public ledger data. May not reflect actual DOF balance.'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
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
            
            {/* No data found message */}
            {data.no_data_found && (
              <Alert className="py-2">
                <AlertDescription className="text-xs text-muted-foreground">
                  No ledger data found for this property in NYC DOF records.
                </AlertDescription>
              </Alert>
            )}
            
            {/* Cache and stats */}
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              {data.cache_status && (
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${data.cache_status === 'HIT' ? 'bg-primary/10' : ''}`}>
                  Cache: {data.cache_status}
                </Badge>
              )}
              {data.total_rows_fetched > 0 && (
                <span>{data.period_count} periods from {data.total_rows_fetched} rows</span>
              )}
            </div>
            
            {/* Debug Panel - only visible when ?debugTaxes=1 */}
            {isDebugMode && data.debug && (
              <Collapsible open={debugOpen} onOpenChange={setDebugOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between h-8 px-2 border-amber-500/50 bg-amber-500/10">
                    <div className="flex items-center gap-2">
                      <Bug className="h-3 w-3 text-amber-600" />
                      <span className="text-xs text-amber-700 dark:text-amber-400">View period buckets (debug)</span>
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
                    {/* Request URL */}
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Request URL:</p>
                      <code className="block bg-muted p-2 rounded text-[10px] break-all">
                        {data.debug.request_url}
                      </code>
                    </div>
                    
                    {/* Fields Used */}
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Fields Used:</p>
                      <div className="bg-muted p-2 rounded text-[10px] space-y-1">
                        <div><strong>due_date:</strong> {data.debug.fields_used.due_date.join(', ')}</div>
                        <div><strong>liability:</strong> {data.debug.fields_used.liability.join(', ')}</div>
                        <div><strong>balance:</strong> {data.debug.fields_used.balance.join(', ')}</div>
                        <div><strong>code:</strong> {data.debug.fields_used.code.join(', ')}</div>
                        <div><strong>tax_year:</strong> {data.debug.fields_used.tax_year.join(', ')}</div>
                        <div><strong>period:</strong> {data.debug.fields_used.period.join(', ')}</div>
                      </div>
                    </div>
                    
                    {/* Counts */}
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Counts:</p>
                      <div className="bg-muted p-2 rounded text-[10px] space-y-1">
                        <div>Total raw rows fetched: {data.total_rows_fetched}</div>
                        <div>Unique period buckets: {data.period_count}</div>
                        <div>Rows in latest period: {data.rows_in_latest_period}</div>
                        <div>Running balance detected: {data.debug.running_balance_detected ? 'Yes' : 'No'}</div>
                      </div>
                    </div>
                    
                    {/* Computed Values */}
                    <div>
                      <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Computed Values:</p>
                      <div className="bg-muted p-2 rounded text-[10px] space-y-1">
                        <div>latest_due_date: {data.latest_due_date || 'null'}</div>
                        <div>latest_bill_amount: {formatUSD(data.latest_bill_amount)}</div>
                        <div>latest_period_balance: {formatUSD(data.latest_period_balance)}</div>
                        <div>payment_status: {data.payment_status}</div>
                        <div>billing_cycle: {data.billing_cycle} ({data.billing_cycle_evidence})</div>
                        <div>arrears: {formatUSD(data.arrears)} ({data.arrears_note})</div>
                        <div>latest_period_key: {data.debug.latest_period_key || 'null'}</div>
                      </div>
                    </div>
                    
                    {/* First Row Keys */}
                    {data.debug.first_row_keys.length > 0 && (
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
                          First Row Keys ({data.debug.first_row_keys.length}):
                        </p>
                        <code className="block bg-muted p-2 rounded text-[10px] break-all">
                          {data.debug.first_row_keys.join(', ')}
                        </code>
                      </div>
                    )}
                    
                    {/* Period Buckets Table */}
                    {data.debug.periods.length > 0 && (
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
                          Period Buckets ({data.debug.periods.length} shown):
                        </p>
                        <div className="bg-muted p-2 rounded overflow-auto max-h-64">
                          <table className="text-[10px] w-full">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="text-left p-1">due_date</th>
                                <th className="text-right p-1">max_liab</th>
                                <th className="text-right p-1">max_bal</th>
                                <th className="text-right p-1">rows</th>
                                <th className="text-left p-1">codes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.debug.periods.map((period, idx) => (
                                <tr key={idx} className="border-b border-border/50">
                                  <td className="p-1">{period.due_date || '—'}</td>
                                  <td className="text-right p-1 font-mono">
                                    {Number.isFinite(period.max_liab) ? period.max_liab.toFixed(2) : '—'}
                                  </td>
                                  <td className="text-right p-1 font-mono">
                                    {Number.isFinite(period.max_bal) ? period.max_bal.toFixed(2) : '—'}
                                  </td>
                                  <td className="text-right p-1">{period.row_count}</td>
                                  <td className="p-1">{period.codes.join(', ') || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    
                    {/* Computation Log */}
                    {data.debug.computation_log.length > 0 && (
                      <div>
                        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">Computation Log:</p>
                        <div className="bg-muted p-2 rounded space-y-1 max-h-48 overflow-auto">
                          {data.debug.computation_log.map((step, idx) => (
                            <div key={idx} className="text-[10px] font-mono">{step}</div>
                          ))}
                        </div>
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
