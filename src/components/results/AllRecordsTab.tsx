import { useState, useEffect } from 'react';
import { Search, X, Download, Loader2, FileX, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useViolations } from '@/hooks/useViolations';
import { useECB } from '@/hooks/useECB';
import { usePermits } from '@/hooks/usePermits';
import { useSafety } from '@/hooks/useSafety';
import { useAllRecords, AllRecordsFilters } from '@/hooks/useAllRecords';
import { UnifiedRecord, RecordSource, ALL_RECORDS_COLUMNS } from '@/types/unified-record';
import { exportToCSV } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';

interface AllRecordsTabProps {
  bbl: string;
  onViewInTab: (tab: string, keyword?: string) => void;
}

const RECORD_TYPE_COLORS: Record<RecordSource, string> = {
  Violation: 'bg-destructive/10 text-destructive border-destructive/20',
  ECB: 'bg-warning/10 text-warning-foreground border-warning/20',
  Permit: 'bg-primary/10 text-primary border-primary/20',
  Safety: 'bg-info/10 text-info border-info/20',
};

const RECORD_TYPE_TAB_MAP: Record<RecordSource, string> = {
  Violation: 'violations',
  ECB: 'ecb',
  Permit: 'permits',
  Safety: 'safety',
};

function StatusBadge({ status }: { status: 'open' | 'closed' | 'unknown' }) {
  const variants: Record<string, 'destructive' | 'secondary' | 'outline'> = {
    open: 'destructive',
    closed: 'secondary',
    unknown: 'outline',
  };
  return (
    <Badge variant={variants[status] || 'outline'} className="capitalize">
      {status}
    </Badge>
  );
}

function RecordTypeBadge({ type }: { type: RecordSource }) {
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${RECORD_TYPE_COLORS[type]}`}>
      {type}
    </span>
  );
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  try {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 p-4 bg-muted/50 rounded-lg">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="h-6 w-48" />
      <div className="rounded-md border">
        <div className="p-4 space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 flex-1" />
              <Skeleton className="h-6 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AllRecordsTab({ bbl, onViewInTab }: AllRecordsTabProps) {
  // Fetch data from all hooks
  const violations = useViolations(bbl);
  const ecb = useECB(bbl);
  const permits = usePermits(bbl);
  const safety = useSafety({ bbl, limit: 100 });

  // Trigger fetches on mount
  useEffect(() => {
    if (bbl && bbl.length === 10) {
      violations.fetchViolations(bbl);
      ecb.fetchECB(bbl);
      permits.fetchPermits(bbl);
    }
  }, [bbl]);

  const isLoading = violations.loading || ecb.loading || permits.loading || safety.loading;
  const hasAnyError = violations.error || ecb.error || permits.error || safety.error;

  // Merge data using the hook
  const {
    loading,
    filteredRecords,
    totalCount,
    filteredCount,
    filters,
    updateFilters,
    resetFilters,
    toggleRecordType,
  } = useAllRecords(
    bbl,
    {
      violations: violations.data?.items || [],
      ecb: ecb.data?.items || [],
      permits: permits.data?.items || [],
      safety: safety.data?.items || [],
    },
    isLoading
  );

  const [displayCount, setDisplayCount] = useState(50);

  const displayedRecords = filteredRecords.slice(0, displayCount);
  const hasMore = displayCount < filteredRecords.length;

  const handleLoadMore = () => {
    setDisplayCount((prev) => prev + 50);
  };

  const handleExportCSV = () => {
    if (filteredRecords.length === 0) return;
    exportToCSV(filteredRecords as unknown as Record<string, unknown>[], {
      filename: `all_records_${bbl}_${new Date().toISOString().split('T')[0]}.csv`,
      columns: ALL_RECORDS_COLUMNS,
    });
    toast({
      title: 'Export complete',
      description: `Exported ${filteredRecords.length} records to CSV`,
    });
  };

  const handleViewInTab = (record: UnifiedRecord) => {
    const tab = RECORD_TYPE_TAB_MAP[record.recordType];
    onViewInTab(tab, record.recordId);
  };

  const hasActiveFilters =
    filters.recordTypes.length < 4 ||
    filters.status !== 'all' ||
    filters.keyword ||
    filters.fromDate ||
    filters.toDate;

  if (isLoading && totalCount === 0) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="p-4 bg-muted/50 rounded-lg space-y-4">
        {/* Record Type Toggles */}
        <div className="flex flex-wrap gap-4 items-center">
          <Label className="text-sm font-medium">Record Types:</Label>
          {(['Violation', 'ECB', 'Permit', 'Safety'] as RecordSource[]).map((type) => (
            <div key={type} className="flex items-center space-x-2">
              <Checkbox
                id={`type-${type}`}
                checked={filters.recordTypes.includes(type)}
                onCheckedChange={() => toggleRecordType(type)}
              />
              <Label htmlFor={`type-${type}`} className="text-sm cursor-pointer">
                {type}
              </Label>
            </div>
          ))}
        </div>

        {/* Search and Other Filters */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, category, description..."
                value={filters.keyword}
                onChange={(e) => updateFilters({ keyword: e.target.value })}
                className="pl-9 bg-card"
              />
            </div>
          </div>

          <Select
            value={filters.status}
            onValueChange={(v) => updateFilters({ status: v as AllRecordsFilters['status'] })}
          >
            <SelectTrigger className="w-32 bg-card">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="unknown">Unknown</SelectItem>
            </SelectContent>
          </Select>

          <Input
            type="date"
            placeholder="From"
            value={filters.fromDate || ''}
            onChange={(e) => updateFilters({ fromDate: e.target.value || undefined })}
            className="w-36 bg-card"
          />

          <Input
            type="date"
            placeholder="To"
            value={filters.toDate || ''}
            onChange={(e) => updateFilters({ toDate: e.target.value || undefined })}
            className="w-36 bg-card"
          />

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Summary Line with Export */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>
            Showing {displayedRecords.length} of {filteredCount} records
            {hasActiveFilters && <span className="ml-1 text-primary">(filtered from {totalCount})</span>}
          </span>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCSV}
          disabled={filteredRecords.length === 0 || isLoading}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          Export All CSV
        </Button>
      </div>

      {/* Error State */}
      {hasAnyError && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
          Some data may be incomplete. Errors: {[violations.error, ecb.error, permits.error, safety.error].filter(Boolean).join(', ')}
        </div>
      )}

      {/* Empty State */}
      {filteredRecords.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
          <FileX className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-foreground font-medium mb-2">No records found</p>
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters
              ? 'No records match the current filters.'
              : 'No records found for this property.'}
          </p>
          {hasActiveFilters && (
            <Button variant="link" onClick={resetFilters} className="mt-2">
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Data Table */}
      {displayedRecords.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">Date</TableHead>
                <TableHead className="font-semibold">Type</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Category</TableHead>
                <TableHead className="font-semibold">Description</TableHead>
                <TableHead className="font-semibold">Record ID</TableHead>
                <TableHead className="font-semibold w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedRecords.map((record, index) => (
                <TableRow key={`${record.recordType}-${record.recordId}-${index}`}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDate(record.primaryDate)}
                  </TableCell>
                  <TableCell>
                    <RecordTypeBadge type={record.recordType} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={record.status} />
                  </TableCell>
                  <TableCell className="text-sm">
                    {record.category || '-'}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    {record.description ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-sm line-clamp-2 cursor-help">
                              {record.description}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">
                            <p>{record.description}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">{record.recordId}</span>
                  </TableCell>
                  <TableCell>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => handleViewInTab(record)}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>View in {record.recordType} tab</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={handleLoadMore}>
            Load More ({filteredRecords.length - displayCount} remaining)
          </Button>
        </div>
      )}
    </div>
  );
}
