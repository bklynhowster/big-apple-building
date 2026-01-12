import { useSummary } from '@/hooks/useSummary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, FileText, Shield, Hammer, AlertTriangle, Download, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { exportToCSV, SUMMARY_COLUMNS } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';

interface SummaryTabProps {
  bbl: string;
  address?: string;
  onTabChange: (tab: string) => void;
}

interface SummaryCardProps {
  title: string;
  icon: React.ReactNode;
  totalCount: number;
  openCount: number;
  lastActivityDate: string | null;
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

function SummaryCard({ title, icon, totalCount, openCount, lastActivityDate, tabKey, onTabChange }: SummaryCardProps) {
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
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="font-semibold text-lg">{totalCount}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Open</span>
          <span className={cn("px-2 py-0.5 rounded-full text-sm font-medium", getStatusBadgeColor(openCount))}>
            {openCount}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Last Activity</span>
          <span className="text-sm">{formatDate(lastActivityDate)}</span>
        </div>
        <button 
          className="w-full text-sm text-primary hover:underline text-center pt-2"
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

export function SummaryTab({ bbl, address, onTabChange }: SummaryTabProps) {
  const { loading, error, data } = useSummary(bbl);

  const handleExportSummaryCSV = () => {
    if (!data) return;
    
    const summaryData = [
      {
        recordType: 'Violations',
        totalCount: data.violations.totalCount,
        openCount: data.violations.openCount,
        lastActivityDate: data.violations.lastActivityDate || '',
      },
      {
        recordType: 'ECB',
        totalCount: data.ecb.totalCount,
        openCount: data.ecb.openCount,
        lastActivityDate: data.ecb.lastActivityDate || '',
      },
      {
        recordType: 'Permits',
        totalCount: data.permits.totalCount,
        openCount: data.permits.openCount,
        lastActivityDate: data.permits.lastActivityDate || '',
      },
      {
        recordType: 'Safety',
        totalCount: data.safety.totalCount,
        openCount: data.safety.openCount,
        lastActivityDate: data.safety.lastActivityDate || '',
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

  if (!data) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>No data available for this property.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Export Actions */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">BBL: {bbl}</p>
          {address && <p className="font-medium">{address}</p>}
          {data.overall.totalOpenCount > 0 ? (
            <p className="text-sm text-destructive font-medium">
              {data.overall.totalOpenCount} open issue{data.overall.totalOpenCount !== 1 ? 's' : ''} across all categories
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Violations"
          icon={<FileText className="h-4 w-4" />}
          totalCount={data.violations.totalCount}
          openCount={data.violations.openCount}
          lastActivityDate={data.violations.lastActivityDate}
          tabKey="violations"
          onTabChange={onTabChange}
        />
        <SummaryCard
          title="ECB"
          icon={<AlertTriangle className="h-4 w-4" />}
          totalCount={data.ecb.totalCount}
          openCount={data.ecb.openCount}
          lastActivityDate={data.ecb.lastActivityDate}
          tabKey="ecb"
          onTabChange={onTabChange}
        />
        <SummaryCard
          title="Permits"
          icon={<Hammer className="h-4 w-4" />}
          totalCount={data.permits.totalCount}
          openCount={data.permits.openCount}
          lastActivityDate={data.permits.lastActivityDate}
          tabKey="permits"
          onTabChange={onTabChange}
        />
        <SummaryCard
          title="Safety"
          icon={<Shield className="h-4 w-4" />}
          totalCount={data.safety.totalCount}
          openCount={data.safety.openCount}
          lastActivityDate={data.safety.lastActivityDate}
          tabKey="safety"
          onTabChange={onTabChange}
        />
      </div>

      {/* Overall Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm text-muted-foreground">
        {data.overall.overallLastActivityDate && (
          <p>
            Last activity across all records: {formatDate(data.overall.overallLastActivityDate)}
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
