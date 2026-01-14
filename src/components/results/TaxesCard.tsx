import { useState, useMemo } from 'react';
import { ExternalLink, DollarSign, FileText, Copy, Check, Info, Building2, Home } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface TaxesCardProps {
  viewBbl: string;           // The unit BBL the user is viewing (could be unit or building)
  buildingBbl?: string;      // The parent building BBL (for condo units)
  address?: string;
  isUnitPage?: boolean;
}

// Parse BBL into borough, block, lot
function parseBBL(bbl: string): { borough: string; block: string; lot: string } | null {
  if (bbl.length !== 10) return null;
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

// Generate DOF CityPay URL (for current balance/charges)
function getDOFCityPayUrl(bbl: string): string {
  // CityPay allows BBL search but doesn't support pre-filling via URL params
  // User will need to enter the BBL manually
  return 'https://a836-citypay.nyc.gov/citypay/PropertyTax';
}

// Generate DOF Property Tax Bills URL
function getDOFBillsUrl(): string {
  return 'https://www.nyc.gov/site/finance/property/property-tax-bills-and-payments.page';
}

export function TaxesCard({ viewBbl, buildingBbl, address, isUnitPage = false }: TaxesCardProps) {
  const [copiedBbl, setCopiedBbl] = useState<string | null>(null);
  
  // For condo units, try unit BBL first, fall back to building BBL
  // The taxLookupBbl is what we suggest users search for
  const taxLookupBbl = useMemo(() => {
    // On unit pages, prefer unit BBL for tax lookup
    if (isUnitPage && viewBbl) {
      return viewBbl;
    }
    // For buildings, use the building BBL
    return buildingBbl || viewBbl;
  }, [viewBbl, buildingBbl, isUnitPage]);
  
  // Track which BBL we're using for display
  const isUsingUnitBbl = isUnitPage && taxLookupBbl === viewBbl && buildingBbl && viewBbl !== buildingBbl;
  const isUsingBuildingBbl = taxLookupBbl === buildingBbl && buildingBbl !== viewBbl;
  
  const parsedBbl = parseBBL(taxLookupBbl);
  const boroughName = parsedBbl ? BOROUGH_NAMES[parsedBbl.borough] : '';
  
  const handleCopyBbl = async (bblToCopy: string) => {
    try {
      await navigator.clipboard.writeText(bblToCopy);
      setCopiedBbl(bblToCopy);
      setTimeout(() => setCopiedBbl(null), 2000);
    } catch (err) {
      console.error('Failed to copy BBL:', err);
    }
  };
  
  const formatBblForDisplay = (bbl: string) => {
    const parsed = parseBBL(bbl);
    if (!parsed) return bbl;
    return `${parsed.borough}-${parsed.block}-${parsed.lot}`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Property Taxes</CardTitle>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <Info className="h-4 w-4 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-sm">
                  NYC DOF is the source of truth for current balance due. 
                  You may not receive a bill if taxes are paid through a bank or mortgage servicing company.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <CardDescription>
          View official NYC Department of Finance property tax records
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Tax Lookup BBL Indicator */}
        <div className="flex items-center gap-2 text-sm">
          {isUsingUnitBbl ? (
            <>
              <Home className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Tax lookup:</span>
              <Badge variant="outline" className="font-mono text-xs">
                Unit BBL {formatBblForDisplay(taxLookupBbl)}
              </Badge>
            </>
          ) : isUsingBuildingBbl ? (
            <>
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Tax lookup:</span>
              <Badge variant="secondary" className="font-mono text-xs">
                Building BBL {formatBblForDisplay(taxLookupBbl)}
              </Badge>
            </>
          ) : (
            <>
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Tax lookup:</span>
              <Badge variant="outline" className="font-mono text-xs">
                BBL {formatBblForDisplay(taxLookupBbl)}
              </Badge>
            </>
          )}
          
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 ml-1"
            onClick={() => handleCopyBbl(taxLookupBbl)}
          >
            {copiedBbl === taxLookupBbl ? (
              <Check className="h-3 w-3 text-primary" />
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </Button>
        </div>
        
        {/* Note for condo unit fallback */}
        {isUnitPage && buildingBbl && (
          <Alert className="py-2">
            <AlertDescription className="text-xs text-muted-foreground">
              If unit tax account is not found, try the building BBL: {formatBblForDisplay(buildingBbl)}
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 ml-1 inline-flex"
                onClick={() => handleCopyBbl(buildingBbl)}
              >
                {copiedBbl === buildingBbl ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        
        {/* DOF Links */}
        <div className="grid gap-3">
          {/* Property Tax Account (Balance Due) */}
          <a
            href={getDOFCityPayUrl(taxLookupBbl)}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <div className="flex items-center justify-between p-3 rounded-md border border-border bg-muted/30 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                  <DollarSign className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">Property Tax Account</p>
                  <p className="text-xs text-muted-foreground">Current balance due & payment history</p>
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </div>
          </a>
          
          {/* Property Tax Bills & Notices */}
          <a
            href={getDOFBillsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <div className="flex items-center justify-between p-3 rounded-md border border-border bg-muted/30 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary/50">
                  <FileText className="h-5 w-5 text-secondary-foreground" />
                </div>
                <div>
                  <p className="font-medium text-sm">Property Tax Bills & Notices</p>
                  <p className="text-xs text-muted-foreground">Current and past bills, notices, exemptions</p>
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </div>
          </a>
        </div>
        
        {/* BBL Instruction */}
        {parsedBbl && (
          <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
            <p className="font-medium mb-1">To search on DOF sites, enter:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Borough: <span className="font-mono">{boroughName} ({parsedBbl.borough})</span></li>
              <li>Block: <span className="font-mono">{parseInt(parsedBbl.block, 10)}</span></li>
              <li>Lot: <span className="font-mono">{parseInt(parsedBbl.lot, 10)}</span></li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
