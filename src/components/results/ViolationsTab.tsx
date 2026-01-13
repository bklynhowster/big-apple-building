import { useState, useEffect, useMemo } from 'react';
import { Search, X, ChevronLeft, ChevronRight, Loader2, FileX, Download } from 'lucide-react';
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
import { useViolations, ViolationsFilters, ViolationRecord } from '@/hooks/useViolations';
import { useRecordUnitMentions } from '@/hooks/useRecordUnitMentions';
import { exportToCSV, VIOLATIONS_COLUMNS } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';
import { ErrorBanner } from '@/components/ui/error-banner';
import { RecordDetailDrawer, RecordType } from './RecordDetailDrawer';
import { ColumnSelector, useColumnVisibility, ColumnConfig } from './ColumnSelector';
import { QueriedIdentifier, DatasetCapability } from './QueriedIdentifier';
import { QueryScope } from './ScopeSelector';
import { BuildingLevelBanner } from './BuildingLevelBanner';
import { UnitMentionBadges } from './UnitMentionBadges';
import { UnitMentionFilter } from './UnitMentionFilter';
import { normalizeUnit } from '@/utils/unit';

interface ViolationsTabProps {
  bbl: string;
  bin?: string;
  scope?: QueryScope;
  isCoop?: boolean;
  coopUnitContext?: string | null;
}

const COLUMN_CONFIGS: ColumnConfig[] = [
  { key: 'issueDate', label: 'Issue Date', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'mentions', label: 'Mentions', defaultVisible: true },
  { key: 'category', label: 'Category', defaultVisible: true },
  { key: 'description', label: 'Description', defaultVisible: true },
  { key: 'recordId', label: 'Record ID', defaultVisible: true },
  { key: 'resolvedDate', label: 'Resolved Date', defaultVisible: false },
  { key: 'lawSection', label: 'Law Section', defaultVisible: false },
];

function StatusBadge({ status }: { status: ViolationRecord['status'] }) {
  const variants: Record<string, 'destructive' | 'secondary' | 'outline'> = {
    open: 'destructive',
    resolved: 'secondary',
    unknown: 'outline',
  };

  return (
    <Badge variant={variants[status] || 'outline'} className="font-medium capitalize">
      {status}
    </Badge>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
        <Skeleton className="h-10 flex-1" />
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-36" />
          <Skeleton className="h-10 w-20" />
        </div>
      </div>
      <Skeleton className="h-6 w-64" />
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

export function ViolationsTab({ bbl, bin, scope = 'building', isCoop = false, coopUnitContext }: ViolationsTabProps) {
  const {
    loading,
    error,
    data,
    filters,
    offset,
    fetchViolations,
    setFilters,
    applyFilters,
    goToNextPage,
    goToPrevPage,
    retry,
  } = useViolations(bbl);

  const [localFilters, setLocalFilters] = useState<ViolationsFilters>({
    status: 'all',
    keyword: '',
  });
  
  // Unit mention filter state
  const [showMentionsOnly, setShowMentionsOnly] = useState(false);
  const [selectedMentionUnit, setSelectedMentionUnit] = useState<string | null>(null);
  const [showContextOnly, setShowContextOnly] = useState(false);
  
  // Drawer state
  const [selectedRecord, setSelectedRecord] = useState<ViolationRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // Column visibility
  const { visibleColumns, toggle, reset, isVisible } = useColumnVisibility(COLUMN_CONFIGS);

  const items = data?.items || [];
  
  // Extract unit mentions from records
  const {
    recordsWithMentions,
    allMentionedUnits,
    recordsWithMentionsCount,
    filterByUnit,
    filterToMentionsOnly,
  } = useRecordUnitMentions(items, coopUnitContext);

  // Apply unit mention filters
  const filteredRecordsWithMentions = useMemo(() => {
    let result = recordsWithMentions;
    
    if (showMentionsOnly) {
      result = filterToMentionsOnly();
    } else if (selectedMentionUnit) {
      result = filterByUnit(selectedMentionUnit);
    }
    
    if (showContextOnly && coopUnitContext) {
      const normalizedContext = normalizeUnit(coopUnitContext);
      result = result.filter(rwm => 
        rwm.mentions.some(m => m.unit === normalizedContext)
      );
    }
    
    return result;
  }, [recordsWithMentions, showMentionsOnly, selectedMentionUnit, showContextOnly, coopUnitContext, filterByUnit, filterToMentionsOnly]);

  useEffect(() => {
    if (bbl && bbl.length === 10) {
      fetchViolations(bbl);
    }
  }, [bbl, fetchViolations]);

  const handleFilterChange = (updates: Partial<ViolationsFilters>) => {
    const newFilters = { ...localFilters, ...updates };
    setLocalFilters(newFilters);
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    const clearedFilters: ViolationsFilters = {
      status: 'all',
      keyword: '',
      fromDate: undefined,
      toDate: undefined,
    };
    setLocalFilters(clearedFilters);
    setFilters(clearedFilters);
    // Also clear unit filters
    setShowMentionsOnly(false);
    setSelectedMentionUnit(null);
    setShowContextOnly(false);
  };

  const handleApply = () => {
    applyFilters();
  };
  
  const handleRowClick = (record: ViolationRecord) => {
    setSelectedRecord(record);
    setDrawerOpen(true);
  };

  const hasActiveFilters =
    localFilters.status !== 'all' ||
    localFilters.keyword ||
    localFilters.fromDate ||
    localFilters.toDate ||
    showMentionsOnly ||
    selectedMentionUnit ||
    showContextOnly;

  // Dataset capability for DOB Violations - it's BBL-based but building-level
  const datasetCapability: DatasetCapability = 'building-bbl';

  if (loading && !data) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="space-y-4">
        <ErrorBanner 
          error={error} 
          onRetry={retry}
          retrying={loading}
        />
      </div>
    );
  }

  const totalApprox = data?.totalApprox || 0;
  const hasNextPage = data?.nextOffset !== null;
  const hasPrevPage = offset > 0;
  const currentPage = Math.floor(offset / 50) + 1;

  const handleExportCSV = () => {
    if (items.length === 0) return;
    exportToCSV(items as unknown as Record<string, unknown>[], {
      filename: `violations_${bbl}_${new Date().toISOString().split('T')[0]}.csv`,
      columns: VIOLATIONS_COLUMNS,
    });
    toast({
      title: 'Export complete',
      description: `Exported ${items.length} violations to CSV`,
    });
  };

  // Use filtered items for display
  const displayItems = filteredRecordsWithMentions;

  return (
    <div className="space-y-4">
      {/* Co-op building-level info banner */}
      {isCoop && <BuildingLevelBanner coopUnitContext={coopUnitContext} />}
      
      {/* Queried Identifier */}
      <QueriedIdentifier
        bbl={bbl}
        bin={bin}
        scope={scope}
        datasetCapability={datasetCapability}
        datasetName="DOB Violations (3h2n-5cm9)"
      />
      
      {/* Unit Mention Filter (for co-ops or when mentions exist) */}
      {(isCoop || recordsWithMentionsCount > 0) && items.length > 0 && (
        <UnitMentionFilter
          allMentionedUnits={allMentionedUnits}
          mentionCount={recordsWithMentionsCount}
          totalCount={items.length}
          selectedUnit={selectedMentionUnit}
          showMentionsOnly={showMentionsOnly}
          coopUnitContext={coopUnitContext}
          showContextOnly={showContextOnly}
          onUnitChange={setSelectedMentionUnit}
          onMentionsOnlyChange={setShowMentionsOnly}
          onContextOnlyChange={setShowContextOnly}
        />
      )}
      
      <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by description..."
              value={localFilters.keyword || ''}
              onChange={(e) => handleFilterChange({ keyword: e.target.value })}
              className="pl-9 bg-card"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <Select
            value={localFilters.status}
            onValueChange={(v) => handleFilterChange({ status: v as ViolationsFilters['status'] })}
          >
            <SelectTrigger className="w-32 bg-card">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
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

      {/* Summary Line with Export & Column Selector */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          Showing {displayItems.length} of ~{totalApprox} DOB violations
          {hasActiveFilters && <span className="ml-2 text-primary">(filtered)</span>}
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          <ColumnSelector
            columns={COLUMN_CONFIGS}
            visibleColumns={visibleColumns}
            onToggle={toggle}
            onReset={reset}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            disabled={items.length === 0 || loading}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Empty State */}
      {displayItems.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
          <FileX className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-foreground font-medium mb-2">No DOB violations found</p>
          <p className="text-sm text-muted-foreground">
            {showMentionsOnly || selectedMentionUnit || showContextOnly
              ? 'No violations match the current unit filter.'
              : 'No DOB violations found for this BBL with the current filters.'}
          </p>
          {hasActiveFilters && (
            <Button variant="link" onClick={handleClearFilters} className="mt-2">
              Clear filters and try again
            </Button>
          )}
        </div>
      )}

      {/* Data Table */}
      {displayItems.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {isVisible('issueDate') && <TableHead className="font-semibold">Issue Date</TableHead>}
                {isVisible('status') && <TableHead className="font-semibold">Status</TableHead>}
                {isVisible('mentions') && (
                  <TableHead className="font-semibold">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger className="flex items-center gap-1 cursor-help">
                          Mentions
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>Units explicitly mentioned in this record's text. Does not imply unit-level enforcement.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableHead>
                )}
                {isVisible('category') && <TableHead className="font-semibold">Category</TableHead>}
                {isVisible('description') && <TableHead className="font-semibold">Description</TableHead>}
                {isVisible('recordId') && <TableHead className="font-semibold">Record ID</TableHead>}
                {isVisible('resolvedDate') && <TableHead className="font-semibold">Resolved Date</TableHead>}
                {isVisible('lawSection') && <TableHead className="font-semibold">Law Section</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayItems.map(({ record: item, mentions, matchesContext }, index) => (
                <TableRow 
                  key={`${item.recordId}-${index}`}
                  className={`
                    cursor-pointer hover:bg-muted/50
                    ${matchesContext ? 'bg-primary/5 border-l-2 border-l-primary' : ''}
                  `}
                  onClick={() => handleRowClick(item)}
                >
                  {isVisible('issueDate') && (
                    <TableCell className="text-sm">
                      {item.issueDate
                        ? new Date(item.issueDate).toLocaleDateString()
                        : '-'}
                    </TableCell>
                  )}
                  {isVisible('status') && (
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                  )}
                  {isVisible('mentions') && (
                    <TableCell>
                      <UnitMentionBadges 
                        mentions={mentions} 
                        matchesContext={matchesContext}
                        compact
                      />
                    </TableCell>
                  )}
                  {isVisible('category') && (
                    <TableCell className="text-sm">
                      {item.category || '-'}
                    </TableCell>
                  )}
                  {isVisible('description') && (
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
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  )}
                  {isVisible('recordId') && (
                    <TableCell>
                      <span className="font-mono text-sm">{item.recordId}</span>
                    </TableCell>
                  )}
                  {isVisible('resolvedDate') && (
                    <TableCell className="text-sm">
                      {item.resolvedDate
                        ? new Date(item.resolvedDate).toLocaleDateString()
                        : '-'}
                    </TableCell>
                  )}
                  {isVisible('lawSection') && (
                    <TableCell className="text-sm">
                      {(item.raw as Record<string, unknown>)?.law_section as string || '-'}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {displayItems.length > 0 && (
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
      
      {/* Record Detail Drawer */}
      <RecordDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        recordType="violation"
        record={selectedRecord as unknown as Record<string, unknown>}
      />
    </div>
  );
}
