import { useState, useEffect } from 'react';
import { Search, X, ChevronLeft, ChevronRight, Loader2, AlertCircle, FileX, Calendar } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { usePermits, PermitsFilters, PermitRecord } from '@/hooks/usePermits';

interface PermitsTabProps {
  bbl: string | null;
}

function StatusBadge({ status }: { status: PermitRecord['status'] }) {
  const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
    open: 'default',
    closed: 'secondary',
    unknown: 'outline',
  };

  const labels: Record<string, string> = {
    open: 'Active',
    closed: 'Closed',
    unknown: 'Unknown',
  };

  return (
    <Badge variant={variants[status] || 'outline'} className="font-medium">
      {labels[status] || status}
    </Badge>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {/* Filter bar skeleton */}
      <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
        <Skeleton className="h-10 flex-1" />
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-20" />
        </div>
      </div>
      
      {/* Summary skeleton */}
      <Skeleton className="h-6 w-64" />
      
      {/* Table skeleton */}
      <div className="rounded-md border">
        <div className="p-4 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-6 w-24" />
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

export function PermitsTab({ bbl }: PermitsTabProps) {
  const {
    loading,
    error,
    data,
    filters,
    offset,
    fetchPermits,
    setFilters,
    applyFilters,
    goToNextPage,
    goToPrevPage,
  } = usePermits(bbl);

  const [localFilters, setLocalFilters] = useState<PermitsFilters>({
    status: 'all',
    keyword: '',
  });

  // Fetch on mount when bbl is available
  useEffect(() => {
    if (bbl) {
      fetchPermits(bbl);
    }
  }, [bbl]);

  const handleFilterChange = (updates: Partial<PermitsFilters>) => {
    const newFilters = { ...localFilters, ...updates };
    setLocalFilters(newFilters);
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    const clearedFilters: PermitsFilters = {
      status: 'all',
      keyword: '',
      fromDate: undefined,
      toDate: undefined,
    };
    setLocalFilters(clearedFilters);
    setFilters(clearedFilters);
  };

  const handleApply = () => {
    applyFilters();
  };

  const hasActiveFilters =
    localFilters.status !== 'all' ||
    localFilters.keyword ||
    localFilters.fromDate ||
    localFilters.toDate;

  // Loading state
  if (loading && !data) {
    return <LoadingSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <p className="text-foreground font-medium mb-2">Failed to load permits</p>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" onClick={() => bbl && fetchPermits(bbl)}>
          Try Again
        </Button>
      </div>
    );
  }

  const items = data?.items || [];
  const totalApprox = data?.totalApprox || 0;
  const hasNextPage = data?.nextOffset !== null;
  const hasPrevPage = offset > 0;
  const currentPage = Math.floor(offset / 50) + 1;

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by permit type, work type..."
              value={localFilters.keyword || ''}
              onChange={(e) => handleFilterChange({ keyword: e.target.value })}
              className="pl-9 bg-card"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <Select
            value={localFilters.status}
            onValueChange={(v) => handleFilterChange({ status: v as PermitsFilters['status'] })}
          >
            <SelectTrigger className="w-32 bg-card">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Active</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>

          <Input
            type="date"
            placeholder="From"
            value={localFilters.fromDate || ''}
            onChange={(e) => handleFilterChange({ fromDate: e.target.value || undefined })}
            className="w-36 bg-card"
          />

          <Input
            type="date"
            placeholder="To"
            value={localFilters.toDate || ''}
            onChange={(e) => handleFilterChange({ toDate: e.target.value || undefined })}
            className="w-36 bg-card"
          />

          <Button onClick={handleApply} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
          </Button>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={handleClearFilters}>
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* BBL Display */}
      {bbl && (
        <div className="text-xs text-muted-foreground font-mono bg-muted/30 px-2 py-1 rounded inline-block">
          BBL: {bbl}
        </div>
      )}

      {/* Summary Line */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          Showing {items.length} of ~{totalApprox} permits
          {hasActiveFilters && <span className="ml-2 text-primary">(filtered)</span>}
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>

      {/* Empty State */}
      {items.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
          <FileX className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-foreground font-medium mb-2">No permits found</p>
          <p className="text-sm text-muted-foreground">
            No permits found for this property with the current filters.
          </p>
          {hasActiveFilters && (
            <Button variant="link" onClick={handleClearFilters} className="mt-2">
              Clear filters and try again
            </Button>
          )}
        </div>
      )}

      {/* Data Table */}
      {items.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-semibold">Issue Date</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Type</TableHead>
                <TableHead className="font-semibold">Work Type</TableHead>
                <TableHead className="font-semibold">Description</TableHead>
                <TableHead className="font-semibold">Expiration</TableHead>
                <TableHead className="font-semibold">Job #</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={`${item.recordId}-${index}`}>
                  <TableCell className="text-sm">
                    {item.issueDate
                      ? new Date(item.issueDate).toLocaleDateString()
                      : '-'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {item.permitType || item.category || '-'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.workType || '-'}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    {item.description ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-sm line-clamp-2 cursor-help">
                              {item.description}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md">
                            <p>{item.description}</p>
                            {item.applicantName && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Applicant: {item.applicantName}
                              </p>
                            )}
                            {item.ownerName && (
                              <p className="text-xs text-muted-foreground">
                                Owner: {item.ownerName}
                              </p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.expirationDate ? (
                      <span className={new Date(item.expirationDate) < new Date() ? 'text-destructive' : ''}>
                        {new Date(item.expirationDate).toLocaleDateString()}
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">{item.jobNumber || item.recordId}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {items.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {currentPage}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPrevPage}
              disabled={!hasPrevPage || loading}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToNextPage}
              disabled={!hasNextPage || loading}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
