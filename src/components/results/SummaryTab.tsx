import { useDualScopeSummary, DualScopeSummaryData } from '@/hooks/useDualScopeSummary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, FileText, Shield, Hammer, AlertTriangle, Download, Printer, Home, Building2, Info, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { exportToCSV, SUMMARY_COLUMNS } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UnitStatusPanel } from './UnitStatusPanel';
import { BuildingRecordsSection } from './BuildingRecordsSection';
import { ContextIndicator } from './ContextIndicator';

interface SummaryTabProps {
  bbl: string;
  billingBbl?: string | null;
  address?: string;
  onTabChange: (tab: string) => void;
}

interface BuildingCountCardProps {
  title: string;
  icon: React.ReactNode;
  data: { totalCount: number; openCount: number; lastActivityDate: string | null } | null;
  tabKey: string;
  onTabChange: (tab: string) => void;
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

// Building-only card - used in the collapsible building section
function BuildingCountCard({ 
  title, 
  icon, 
  data, 
  tabKey, 
  onTabChange 
}: BuildingCountCardProps) {
  const openCount = data?.openCount || 0;

  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all hover:shadow-md border-l-4",
        getStatusColor(openCount)
      )}
      onClick={() => onTabChange(tabKey)}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal gap-1">
                <Ban className="h-2.5 w-2.5" />
                Not issued per unit
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>This dataset is issued at the building level only. Records may apply to common areas or shared systems.</p>
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="font-semibold text-lg">{data?.totalCount || 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Open</span>
          <span className={cn("px-2 py-0.5 rounded-full text-sm font-medium", getStatusBadgeColor(openCount))}>
            {openCount}
          </span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Last Activity</span>
          <span className="text-xs">{formatDate(data?.lastActivityDate || null)}</span>
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
      <Skeleton className="h-24 w-full" />
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
  
  // Is this a unit page with different unit vs building BBLs?
  const isUnitPage = isUnitLot && billingBbl && billingBbl !== bbl;

  // Calculate unit-level totals (all datasets are currently building-level, so unit counts are 0)
  const unitTotalOpen = data?.unit 
    ? (data.unit.violations?.openCount || 0) + 
      (data.unit.ecb?.openCount || 0) + 
      (data.unit.permits?.openCount || 0) + 
      (data.unit.safety?.openCount || 0) + 
      (data.unit.hpd?.openCount || 0)
    : 0;
  
  const unitHasRecords = unitTotalOpen > 0;
  
  // Extract unit label from BBL (last 4 digits of lot)
  const unitLabel = isUnitLot ? (parseInt(bbl.slice(-4), 10) - 1000).toString() : null;

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
  const totalBuildingOpenCount = buildingData?.overall.totalOpenCount || 0;

  // UNIT PAGE LAYOUT - completely different structure
  if (isUnitPage) {
    return (
      <div className="space-y-6">
        {/* Context Indicator Pills */}
        <ContextIndicator 
          unitLabel={unitLabel} 
          isUnitView={true}
        />

        {/* Unit Status Panel - Primary focus */}
        <UnitStatusPanel
          unitLabel={unitLabel}
          unitBbl={bbl}
          loading={loading}
          unitHasRecords={unitHasRecords}
          unitOpenCount={unitTotalOpen}
        />

        {/* Building Records Section - Secondary, collapsible */}
        <BuildingRecordsSection billingBbl={billingBbl} defaultOpen={true}>
          {/* Export actions for building data */}
          <div className="flex justify-end gap-2 mb-4 print:hidden">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportSummaryCSV}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Export Building Summary
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

          {/* Building status summary */}
          {totalBuildingOpenCount > 0 ? (
            <p className="text-sm text-muted-foreground mb-4">
              <span className="font-medium text-foreground">{totalBuildingOpenCount}</span> open issue{totalBuildingOpenCount !== 1 ? 's' : ''} at the building level
            </p>
          ) : (
            <p className="text-sm text-green-600 mb-4">No open building-level issues</p>
          )}

          {/* Building Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <BuildingCountCard
              title="Violations"
              icon={<FileText className="h-4 w-4" />}
              data={buildingData?.violations || null}
              tabKey="violations"
              onTabChange={onTabChange}
            />
            <BuildingCountCard
              title="ECB"
              icon={<AlertTriangle className="h-4 w-4" />}
              data={buildingData?.ecb || null}
              tabKey="ecb"
              onTabChange={onTabChange}
            />
            <BuildingCountCard
              title="Permits"
              icon={<Hammer className="h-4 w-4" />}
              data={buildingData?.permits || null}
              tabKey="permits"
              onTabChange={onTabChange}
            />
            <BuildingCountCard
              title="Safety"
              icon={<Shield className="h-4 w-4" />}
              data={buildingData?.safety || null}
              tabKey="safety"
              onTabChange={onTabChange}
            />
            <BuildingCountCard
              title="HPD"
              icon={<AlertCircle className="h-4 w-4" />}
              data={buildingData?.hpd || null}
              tabKey="hpd"
              onTabChange={onTabChange}
            />
          </div>

          {/* Last activity note */}
          {buildingData?.overall.overallLastActivityDate && (
            <p className="text-xs text-muted-foreground mt-4">
              Last building activity: {formatDate(buildingData.overall.overallLastActivityDate)}
            </p>
          )}
        </BuildingRecordsSection>

        {/* Print footer */}
        <p className="print:block hidden text-sm text-muted-foreground">
          Report generated on {new Date().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}
        </p>
      </div>
    );
  }

  // BUILDING PAGE LAYOUT - standard summary view
  return (
    <div className="space-y-6">
      {/* Header with Export Actions */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">BBL: {bbl}</p>
          {address && <p className="font-medium">{address}</p>}
          {totalBuildingOpenCount > 0 ? (
            <p className="text-sm text-destructive font-medium">
              {totalBuildingOpenCount} open issue{totalBuildingOpenCount !== 1 ? 's' : ''} across all categories
            </p>
          ) : (
            <p className="text-sm text-green-600 font-medium">No open issues</p>
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
        <BuildingCountCard
          title="Violations"
          icon={<FileText className="h-4 w-4" />}
          data={buildingData?.violations || null}
          tabKey="violations"
          onTabChange={onTabChange}
        />
        <BuildingCountCard
          title="ECB"
          icon={<AlertTriangle className="h-4 w-4" />}
          data={buildingData?.ecb || null}
          tabKey="ecb"
          onTabChange={onTabChange}
        />
        <BuildingCountCard
          title="Permits"
          icon={<Hammer className="h-4 w-4" />}
          data={buildingData?.permits || null}
          tabKey="permits"
          onTabChange={onTabChange}
        />
        <BuildingCountCard
          title="Safety"
          icon={<Shield className="h-4 w-4" />}
          data={buildingData?.safety || null}
          tabKey="safety"
          onTabChange={onTabChange}
        />
        <BuildingCountCard
          title="HPD"
          icon={<AlertCircle className="h-4 w-4" />}
          data={buildingData?.hpd || null}
          tabKey="hpd"
          onTabChange={onTabChange}
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
