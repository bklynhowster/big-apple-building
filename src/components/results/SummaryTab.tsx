import { useDualScopeSummary, DualScopeSummaryData } from '@/hooks/useDualScopeSummary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, FileText, Shield, Hammer, AlertTriangle, Download, Printer, Home, Building2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { exportToCSV, SUMMARY_COLUMNS } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SummaryTabProps {
  bbl: string;
  billingBbl?: string | null;
  address?: string;
  onTabChange: (tab: string) => void;
}

interface DualCountCardProps {
  title: string;
  icon: React.ReactNode;
  unitData: { totalCount: number; openCount: number; lastActivityDate: string | null } | null;
  buildingData: { totalCount: number; openCount: number; lastActivityDate: string | null } | null;
  isUnitCapable: boolean;
  tabKey: string;
  onTabChange: (tab: string) => void;
  showDualCounts: boolean;
}

function getStatusColor(openCount: number): string {
  if (openCount === 0) return 'border-l-green-500';
  if (openCount <= 3) return 'border-l-yellow-500';
  return 'border-l-destructive';
}

function getStatusBadgeColor(openCount: number): string {
  if (openCount === 0) return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (openCount <= 3) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  return 'bg-destructive/10 text-destructive';
}

function formatDate(dateString: string | null): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'N/A';
  }
}

function DualCountCard({ 
  title, 
  icon, 
  unitData, 
  buildingData, 
  isUnitCapable, 
  tabKey, 
  onTabChange,
  showDualCounts 
}: DualCountCardProps) {
  // When showing dual counts on unit page, unit is primary; otherwise building is primary
  const unitOpenCount = unitData?.openCount || 0;
  const buildingOpenCount = buildingData?.openCount || 0;
  
  // Use unit data for border color when in dual mode, otherwise use building
  const primaryOpenCount = showDualCounts ? unitOpenCount : buildingOpenCount;

  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all hover:shadow-md border-l-4",
        getStatusColor(primaryOpenCount)
      )}
      onClick={() => onTabChange(tabKey)}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
          {!isUnitCapable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] px-1 py-0 font-normal">
                  Building-level
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>This dataset only supports building-level queries</p>
              </TooltipContent>
            </Tooltip>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {showDualCounts ? (
          <div className="space-y-2">
            {/* Unit count - PRIMARY, visually dominant */}
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Home className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">Unit</span>
                </div>
                {isUnitCapable && unitData ? (
                  <span className={cn(
                    "text-2xl font-bold",
                    unitData.openCount > 0 ? 'text-destructive' : 'text-green-600'
                  )}>
                    {unitData.openCount}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              {!isUnitCapable && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Building-level dataset
                </p>
              )}
            </div>
            
            {/* Building count - SECONDARY, muted */}
            <div className="flex items-center justify-between px-2 py-1.5 text-muted-foreground">
              <div className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5" />
                <span className="text-xs">Building total</span>
              </div>
              <span className="text-sm font-medium">
                {buildingData?.openCount || 0}
              </span>
            </div>
          </div>
        ) : (
          <>
            {/* Single count view (building only) */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-semibold text-lg">{buildingData?.totalCount || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Open</span>
              <span className={cn("px-2 py-0.5 rounded-full text-sm font-medium", getStatusBadgeColor(buildingOpenCount))}>
                {buildingOpenCount}
              </span>
            </div>
          </>
        )}
        
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Last Activity</span>
          <span className="text-xs">{formatDate(buildingData?.lastActivityDate || null)}</span>
        </div>
        
        <button 
          className="w-full text-sm text-primary hover:underline text-center pt-1"
          onClick={(e) => {
            e.stopPropagation();
            onTabChange(tabKey);
          }}
        >
          View all →
        </button>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="border-l-4 border-l-muted">
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-4 w-20 mx-auto" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function SummaryTab({ bbl, billingBbl, address, onTabChange }: SummaryTabProps) {
  // Determine if we're on a unit page
  const lotNumber = parseInt(bbl.slice(6), 10);
  const isUnitLot = lotNumber >= 1001 && lotNumber <= 6999;
  
  // For dual scope, use the current BBL as unit and billingBbl as building
  const unitBbl = isUnitLot ? bbl : null;
  const buildingBblToUse = billingBbl || bbl;
  
  const { loading, error, data } = useDualScopeSummary(unitBbl, buildingBblToUse);
  
  // Show dual counts only when we have both unit and building data and they're different
  const showDualCounts = isUnitLot && billingBbl && billingBbl !== bbl;

  const handleExportSummaryCSV = () => {
    if (!data?.building) return;
    
    const buildingData = data.building;
    const summaryData = [
      {
        recordType: 'Violations',
        scope: 'Building',
        totalCount: buildingData.violations.totalCount,
        openCount: buildingData.violations.openCount,
        lastActivityDate: buildingData.violations.lastActivityDate || '',
      },
      {
        recordType: 'ECB',
        scope: 'Building',
        totalCount: buildingData.ecb.totalCount,
        openCount: buildingData.ecb.openCount,
        lastActivityDate: buildingData.ecb.lastActivityDate || '',
      },
      {
        recordType: 'Permits',
        scope: 'Building',
        totalCount: buildingData.permits.totalCount,
        openCount: buildingData.permits.openCount,
        lastActivityDate: buildingData.permits.lastActivityDate || '',
      },
      {
        recordType: 'Safety',
        scope: 'Building',
        totalCount: buildingData.safety.totalCount,
        openCount: buildingData.safety.openCount,
        lastActivityDate: buildingData.safety.lastActivityDate || '',
      },
      {
        recordType: 'HPD',
        scope: 'Building',
        totalCount: buildingData.hpd.totalCount,
        openCount: buildingData.hpd.openCount,
        lastActivityDate: buildingData.hpd.lastActivityDate || '',
      },
    ];

    exportToCSV(summaryData, {
      filename: `summary_${bbl}_${new Date().toISOString().split('T')[0]}.csv`,
      columns: SUMMARY_COLUMNS,
      includeRawColumn: false,
    });
    
    toast({
      title: 'Export complete',
      description: 'Summary exported to CSV',
    });
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load summary: {error}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data?.building && !data?.unit) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>No data available for this property.</AlertDescription>
      </Alert>
    );
  }

  const buildingData = data.building;
  const unitData = data.unit;
  const totalOpenCount = buildingData?.overall.totalOpenCount || 0;

  return (
    <div className="space-y-6">
      {/* Header with Export Actions */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-1">
          {showDualCounts && (
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="gap-1">
                <Home className="h-3 w-3" />
                Unit: {bbl}
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Building2 className="h-3 w-3" />
                Building: {billingBbl}
              </Badge>
            </div>
          )}
          {!showDualCounts && (
            <p className="text-sm text-muted-foreground">BBL: {bbl}</p>
          )}
          {address && <p className="font-medium">{address}</p>}
          {totalOpenCount > 0 ? (
            <p className="text-sm text-destructive font-medium">
              {totalOpenCount} open issue{totalOpenCount !== 1 ? 's' : ''} across all categories (building-level)
            </p>
          ) : (
            <p className="text-sm text-green-600 font-medium">No open issues</p>
          )}
          
          {showDualCounts && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <Info className="h-3 w-3" />
              Cards show Unit vs Building open counts. Most datasets are building-level only.
            </p>
          )}
        </div>
        
        <div className="flex gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportSummaryCSV}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export Summary
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="gap-1.5"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Report
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <DualCountCard
          title="Violations"
          icon={<FileText className="h-4 w-4" />}
          unitData={unitData?.violations || null}
          buildingData={buildingData?.violations || null}
          isUnitCapable={data.isUnitCapable.violations}
          tabKey="violations"
          onTabChange={onTabChange}
          showDualCounts={showDualCounts}
        />
        <DualCountCard
          title="ECB"
          icon={<AlertTriangle className="h-4 w-4" />}
          unitData={unitData?.ecb || null}
          buildingData={buildingData?.ecb || null}
          isUnitCapable={data.isUnitCapable.ecb}
          tabKey="ecb"
          onTabChange={onTabChange}
          showDualCounts={showDualCounts}
        />
        <DualCountCard
          title="Permits"
          icon={<Hammer className="h-4 w-4" />}
          unitData={unitData?.permits || null}
          buildingData={buildingData?.permits || null}
          isUnitCapable={data.isUnitCapable.permits}
          tabKey="permits"
          onTabChange={onTabChange}
          showDualCounts={showDualCounts}
        />
        <DualCountCard
          title="Safety"
          icon={<Shield className="h-4 w-4" />}
          unitData={unitData?.safety || null}
          buildingData={buildingData?.safety || null}
          isUnitCapable={data.isUnitCapable.safety}
          tabKey="safety"
          onTabChange={onTabChange}
          showDualCounts={showDualCounts}
        />
        <DualCountCard
          title="HPD"
          icon={<AlertCircle className="h-4 w-4" />}
          unitData={unitData?.hpd || null}
          buildingData={buildingData?.hpd || null}
          isUnitCapable={data.isUnitCapable.hpd}
          tabKey="hpd"
          onTabChange={onTabChange}
          showDualCounts={showDualCounts}
        />
      </div>

      {/* Overall Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-muted-foreground">
        {buildingData?.overall.overallLastActivityDate && (
          <p>
            Last activity across all records: {formatDate(buildingData.overall.overallLastActivityDate)}
          </p>
        )}
        <p className="print:block hidden">
          Report generated on {new Date().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </p>
      </div>
    </div>
  );
}
