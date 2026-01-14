import { useState, useEffect, useMemo } from 'react';
import { Search, X, ChevronLeft, ChevronRight, Loader2, FileX, Download, Info } from 'lucide-react';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { usePermits, PermitsFilters, PermitRecord } from '@/hooks/usePermits';
import { exportToCSV, PERMITS_COLUMNS } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';
import { ErrorBanner } from '@/components/ui/error-banner';
import { RecordDetailDrawer } from './RecordDetailDrawer';
import { ColumnSelector, useColumnVisibility, ColumnConfig } from './ColumnSelector';
import { QueriedIdentifier, DatasetCapability } from './QueriedIdentifier';
import { QueryScope } from './ScopeSelector';
import { BuildingLevelBanner } from './BuildingLevelBanner';
import { useRecordUnitMentions } from '@/hooks/useRecordUnitMentions';
import { UnitMentionBadges } from './UnitMentionBadges';
import { UnitMentionFilter } from './UnitMentionFilter';

interface PermitsTabProps {
  bbl: string;
  bin?: string;
  scope?: QueryScope;
  isCoop?: boolean;
  coopUnitContext?: string | null;
  address?: string;
}

const COLUMN_CONFIGS: ColumnConfig[] = [
  { key: 'issueDate', label: 'Issue Date', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'mentions', label: 'Mentions', defaultVisible: true },
  { key: 'permitType', label: 'Type', defaultVisible: true },
  { key: 'workType', label: 'Work Type', defaultVisible: true },
  { key: 'description', label: 'Description', defaultVisible: true },
  { key: 'expirationDate', label: 'Expiration', defaultVisible: true },
  { key: 'jobNumber', label: 'Job #', defaultVisible: true },
  { key: 'applicantName', label: 'Applicant', defaultVisible: false },
  { key: 'ownerName', label: 'Owner', defaultVisible: false },
];

function StatusBadge({ status }: { status: PermitRecord['status'] }) {
  const variants: Record<string, 'default' | 'secondary' | 'outline'> = { open: 'default', closed: 'secondary', unknown: 'outline' };
  const labels: Record<string, string> = { open: 'Active', closed: 'Closed', unknown: 'Unknown' };
  return <Badge variant={variants[status] || 'outline'} className="font-medium">{labels[status] || status}</Badge>;
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

export function PermitsTab({ bbl, bin, scope = 'building', isCoop, coopUnitContext, address }: PermitsTabProps) {
  const { loading, error, data, filters, offset, fetchPermits, setFilters, applyFilters, goToNextPage, goToPrevPage, retry } = usePermits(bbl);
  const [localFilters, setLocalFilters] = useState<PermitsFilters>({ status: 'all', keyword: '' });
  
  // Unit mention filter state
  const [showMentionsOnly, setShowMentionsOnly] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [showContextOnly, setShowContextOnly] = useState(false);
  
  // Drawer state
  const [selectedRecord, setSelectedRecord] = useState<PermitRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // Column visibility
  const { visibleColumns, toggle, reset, isVisible } = useColumnVisibility(COLUMN_CONFIGS);

  useEffect(() => {
    if (bbl && bbl.length === 10) fetchPermits(bbl);
  }, [bbl, fetchPermits]);

  // Transform items for unit mention extraction
  const recordsForMentions = useMemo(() => {
    const items = data?.items || [];
    return items.map(item => ({
      ...item,
      raw: item.raw || item as unknown as Record<string, unknown>,
    }));
  }, [data?.items]);

  // Extract unit mentions using the shared hook
  const {
    recordsWithMentions,
    allMentionedUnits,
    recordsWithMentionsCount,
    filterByUnit,
    filterToMentionsOnly,
  } = useRecordUnitMentions(recordsForMentions, coopUnitContext);

  // Apply unit mention filters
  const filteredRecordsWithMentions = useMemo(() => {
    let result = recordsWithMentions;
    
    if (showContextOnly && coopUnitContext) {
      result = result.filter(rwm => rwm.matchesContext);
    } else if (selectedUnit) {
      result = filterByUnit(selectedUnit);
    } else if (showMentionsOnly) {
      result = filterToMentionsOnly();
    }
    
    return result;
  }, [recordsWithMentions, showMentionsOnly, selectedUnit, showContextOnly, coopUnitContext, filterByUnit, filterToMentionsOnly]);

  const handleFilterChange = (updates: Partial<PermitsFilters>) => {
    const newFilters = { ...localFilters, ...updates };
    setLocalFilters(newFilters);
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    const clearedFilters: PermitsFilters = { status: 'all', keyword: '', fromDate: undefined, toDate: undefined };
    setLocalFilters(clearedFilters);
    setFilters(clearedFilters);
    setShowMentionsOnly(false);
    setSelectedUnit(null);
    setShowContextOnly(false);
  };
  
  const handleRowClick = (record: PermitRecord) => {
    setSelectedRecord(record);
    setDrawerOpen(true);
  };

  const hasActiveFilters = localFilters.status !== 'all' || localFilters.keyword || localFilters.fromDate || localFilters.toDate;
  const hasUnitFilters = showMentionsOnly || selectedUnit || showContextOnly;

  if (loading && !data) return <LoadingSkeleton />;
  if (error) return <div className="space-y-4"><ErrorBanner error={error} onRetry={retry} retrying={loading} /></div>;

  // Dataset capability for Permits - BIN-based, building-level
  const datasetCapability: DatasetCapability = 'bin';

  const items = filteredRecordsWithMentions.map(rwm => ({ ...rwm.record, _mentions: rwm.mentions, _matchesContext: rwm.matchesContext }));
  const totalItems = data?.items?.length || 0;
  const totalApprox = data?.totalApprox || 0;
  const hasNextPage = data?.nextOffset !== null;
  const hasPrevPage = offset > 0;
  const currentPage = Math.floor(offset / 50) + 1;

  const handleExportCSV = () => {
    if (items.length === 0) return;
    exportToCSV(items as unknown as Record<string, unknown>[], {
      filename: `permits_${bbl}_${new Date().toISOString().split('T')[0]}.csv`,
      columns: PERMITS_COLUMNS,
    });
    toast({ title: 'Export complete', description: `Exported ${items.length} permits to CSV` });
  };

  return (
    <div className="space-y-4">
      {/* Co-op building-level banner */}
      {isCoop && <BuildingLevelBanner coopUnitContext={coopUnitContext} compact />}
      
      {/* Queried Identifier */}
      <QueriedIdentifier
        bbl={bbl}
        bin={bin}
        scope={scope}
        datasetCapability={datasetCapability}
        datasetName="DOB Permits (ipu4-2vj7)"
      />

      {/* Unit mention disclaimer for co-ops */}
      {isCoop && recordsWithMentionsCount > 0 && (
        <Alert variant="default" className="border-primary/20 bg-primary/5">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            <strong>{recordsWithMentionsCount}</strong> of {totalItems} permits mention specific unit(s). 
            Unit mentions are inferred from permit text; not proof of unit-level enforcement.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by permit type, work type..." value={localFilters.keyword || ''} onChange={(e) => handleFilterChange({ keyword: e.target.value })} className="pl-9 bg-card" />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={localFilters.status} onValueChange={(v) => handleFilterChange({ status: v as PermitsFilters['status'] })}>
            <SelectTrigger className="w-32 bg-card"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Active</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={localFilters.fromDate || ''} onChange={(e) => handleFilterChange({ fromDate: e.target.value || undefined })} className="w-36 bg-card" />
          <Input type="date" value={localFilters.toDate || ''} onChange={(e) => handleFilterChange({ toDate: e.target.value || undefined })} className="w-36 bg-card" />
          <Button onClick={applyFilters} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}</Button>
          {(hasActiveFilters || hasUnitFilters) && <Button variant="ghost" size="sm" onClick={handleClearFilters}><X className="h-4 w-4 mr-1" />Clear</Button>}
        </div>
      </div>

      {/* Unit mention filter (only for co-ops) */}
      {isCoop && (
        <UnitMentionFilter
          allMentionedUnits={allMentionedUnits}
          mentionCount={recordsWithMentionsCount}
          totalCount={totalItems}
          selectedUnit={selectedUnit}
          showMentionsOnly={showMentionsOnly}
          coopUnitContext={coopUnitContext}
          showContextOnly={showContextOnly}
          onUnitChange={setSelectedUnit}
          onMentionsOnlyChange={setShowMentionsOnly}
          onContextOnlyChange={setShowContextOnly}
        />
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          Showing {items.length} of ~{totalApprox} permits
          {(hasActiveFilters || hasUnitFilters) && <span className="ml-2 text-primary">(filtered)</span>}
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          <ColumnSelector columns={COLUMN_CONFIGS} visibleColumns={visibleColumns} onToggle={toggle} onReset={reset} />
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={items.length === 0 || loading} className="gap-1.5"><Download className="h-3.5 w-3.5" />Export CSV</Button>
        </div>
      </div>

      {items.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
          <FileX className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-foreground font-medium mb-2">No permits found</p>
          <p className="text-sm text-muted-foreground">
            {hasUnitFilters 
              ? 'No permits match the current unit filter.'
              : 'No permits found for this property with the current filters.'}
          </p>
          {(hasActiveFilters || hasUnitFilters) && <Button variant="link" onClick={handleClearFilters} className="mt-2">Clear filters and try again</Button>}
        </div>
      )}

      {items.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {isVisible('issueDate') && <TableHead className="font-semibold">Issue Date</TableHead>}
                {isVisible('status') && <TableHead className="font-semibold">Status</TableHead>}
                {isCoop && isVisible('mentions') && <TableHead className="font-semibold">Mentions</TableHead>}
                {isVisible('permitType') && <TableHead className="font-semibold">Type</TableHead>}
                {isVisible('workType') && <TableHead className="font-semibold">Work Type</TableHead>}
                {isVisible('description') && <TableHead className="font-semibold">Description</TableHead>}
                {isVisible('expirationDate') && <TableHead className="font-semibold">Expiration</TableHead>}
                {isVisible('jobNumber') && <TableHead className="font-semibold">Job #</TableHead>}
                {isVisible('applicantName') && <TableHead className="font-semibold">Applicant</TableHead>}
                {isVisible('ownerName') && <TableHead className="font-semibold">Owner</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => {
                const mentions = (item as any)._mentions || [];
                const matchesContext = (item as any)._matchesContext || false;
                
                return (
                  <TableRow 
                    key={`${item.recordId}-${index}`}
                    className={`cursor-pointer hover:bg-muted/50 ${matchesContext ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
                    onClick={() => handleRowClick(item)}
                  >
                    {isVisible('issueDate') && <TableCell className="text-sm">{item.issueDate ? new Date(item.issueDate).toLocaleDateString() : '-'}</TableCell>}
                    {isVisible('status') && <TableCell><StatusBadge status={item.status} /></TableCell>}
                    {isCoop && isVisible('mentions') && (
                      <TableCell>
                        <UnitMentionBadges 
                          mentions={mentions}
                          matchesContext={matchesContext}
                        />
                      </TableCell>
                    )}
                    {isVisible('permitType') && <TableCell className="text-sm font-medium">{item.permitType || item.category || '-'}</TableCell>}
                    {isVisible('workType') && <TableCell className="text-sm">{item.workType || '-'}</TableCell>}
                    {isVisible('description') && (
                      <TableCell className="max-w-xs">
                        {item.description ? (
                          <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="text-sm line-clamp-2 cursor-help">{item.description}</span></TooltipTrigger><TooltipContent className="max-w-md"><p>{item.description}</p>{item.applicantName && <p className="mt-1 text-xs text-muted-foreground">Applicant: {item.applicantName}</p>}{item.ownerName && <p className="text-xs text-muted-foreground">Owner: {item.ownerName}</p>}</TooltipContent></Tooltip></TooltipProvider>
                        ) : <span className="text-muted-foreground">-</span>}
                      </TableCell>
                    )}
                    {isVisible('expirationDate') && (
                      <TableCell className="text-sm">
                        {item.expirationDate ? <span className={new Date(item.expirationDate) < new Date() ? 'text-destructive' : ''}>{new Date(item.expirationDate).toLocaleDateString()}</span> : '-'}
                      </TableCell>
                    )}
                    {isVisible('jobNumber') && <TableCell><span className="font-mono text-sm">{item.jobNumber || item.recordId}</span></TableCell>}
                    {isVisible('applicantName') && <TableCell className="text-sm">{item.applicantName || '-'}</TableCell>}
                    {isVisible('ownerName') && <TableCell className="text-sm">{item.ownerName || '-'}</TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Page {currentPage}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToPrevPage} disabled={!hasPrevPage || loading}><ChevronLeft className="h-4 w-4 mr-1" />Previous</Button>
            <Button variant="outline" size="sm" onClick={goToNextPage} disabled={!hasNextPage || loading}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
          </div>
        </div>
      )}
      
      {/* Record Detail Drawer */}
      <RecordDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        recordType="permit"
        record={selectedRecord as unknown as Record<string, unknown>}
        address={address}
      />
    </div>
  );
}
