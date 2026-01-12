import { useState, useEffect } from 'react';
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
import { useECB, ECBFilters, ECBRecord } from '@/hooks/useECB';
import { exportToCSV, ECB_COLUMNS } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';
import { ErrorBanner } from '@/components/ui/error-banner';
import { RecordDetailDrawer } from './RecordDetailDrawer';
import { ColumnSelector, useColumnVisibility, ColumnConfig } from './ColumnSelector';

interface ECBTabProps {
  bbl: string;
}

const COLUMN_CONFIGS: ColumnConfig[] = [
  { key: 'issueDate', label: 'Issue Date', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'severity', label: 'Severity', defaultVisible: true },
  { key: 'category', label: 'Category', defaultVisible: true },
  { key: 'description', label: 'Description', defaultVisible: true },
  { key: 'penaltyAmount', label: 'Penalty', defaultVisible: true },
  { key: 'balanceDue', label: 'Balance', defaultVisible: true },
  { key: 'recordId', label: 'Record ID', defaultVisible: true },
  { key: 'amountPaid', label: 'Amount Paid', defaultVisible: false },
  { key: 'resolvedDate', label: 'Resolved Date', defaultVisible: false },
];

function StatusBadge({ status }: { status: ECBRecord['status'] }) {
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

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return <span className="text-muted-foreground">-</span>;
  const variants: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
    Hazardous: 'destructive', HAZARDOUS: 'destructive',
    Major: 'default', MAJOR: 'default',
    Minor: 'secondary', MINOR: 'secondary',
  };
  return <Badge variant={variants[severity] || 'outline'} className="font-medium">{severity}</Badge>;
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
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

export function ECBTab({ bbl }: ECBTabProps) {
  const { loading, error, data, filters, offset, fetchECB, setFilters, applyFilters, goToNextPage, goToPrevPage, retry } = useECB(bbl);
  const [localFilters, setLocalFilters] = useState<ECBFilters>({ status: 'all', keyword: '' });
  
  // Drawer state
  const [selectedRecord, setSelectedRecord] = useState<ECBRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // Column visibility
  const { visibleColumns, toggle, reset, isVisible } = useColumnVisibility(COLUMN_CONFIGS);

  useEffect(() => {
    if (bbl && bbl.length === 10) fetchECB(bbl);
  }, [bbl, fetchECB]);

  const handleFilterChange = (updates: Partial<ECBFilters>) => {
    const newFilters = { ...localFilters, ...updates };
    setLocalFilters(newFilters);
    setFilters(newFilters);
  };

  const handleClearFilters = () => {
    const clearedFilters: ECBFilters = { status: 'all', keyword: '', fromDate: undefined, toDate: undefined };
    setLocalFilters(clearedFilters);
    setFilters(clearedFilters);
  };
  
  const handleRowClick = (record: ECBRecord) => {
    setSelectedRecord(record);
    setDrawerOpen(true);
  };

  const hasActiveFilters = localFilters.status !== 'all' || localFilters.keyword || localFilters.fromDate || localFilters.toDate;

  if (loading && !data) return <LoadingSkeleton />;
  if (error) return <div className="space-y-4"><ErrorBanner error={error} onRetry={retry} retrying={loading} /></div>;

  const items = data?.items || [];
  const totalApprox = data?.totalApprox || 0;
  const hasNextPage = data?.nextOffset !== null;
  const hasPrevPage = offset > 0;
  const currentPage = Math.floor(offset / 50) + 1;

  const handleExportCSV = () => {
    if (items.length === 0) return;
    exportToCSV(items as unknown as Record<string, unknown>[], {
      filename: `ecb_violations_${bbl}_${new Date().toISOString().split('T')[0]}.csv`,
      columns: ECB_COLUMNS,
    });
    toast({ title: 'Export complete', description: `Exported ${items.length} ECB violations to CSV` });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by description..." value={localFilters.keyword || ''} onChange={(e) => handleFilterChange({ keyword: e.target.value })} className="pl-9 bg-card" />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <Select value={localFilters.status} onValueChange={(v) => handleFilterChange({ status: v as ECBFilters['status'] })}>
            <SelectTrigger className="w-32 bg-card"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={localFilters.fromDate || ''} onChange={(e) => handleFilterChange({ fromDate: e.target.value || undefined })} className="w-36 bg-card" />
          <Input type="date" value={localFilters.toDate || ''} onChange={(e) => handleFilterChange({ toDate: e.target.value || undefined })} className="w-36 bg-card" />
          <Button onClick={applyFilters} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}</Button>
          {hasActiveFilters && <Button variant="ghost" size="sm" onClick={handleClearFilters}><X className="h-4 w-4 mr-1" />Clear</Button>}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>Showing {items.length} of ~{totalApprox} ECB summonses{hasActiveFilters && <span className="ml-2 text-primary">(filtered)</span>}</div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          <ColumnSelector columns={COLUMN_CONFIGS} visibleColumns={visibleColumns} onToggle={toggle} onReset={reset} />
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={items.length === 0 || loading} className="gap-1.5"><Download className="h-3.5 w-3.5" />Export CSV</Button>
        </div>
      </div>

      {items.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
          <FileX className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-foreground font-medium mb-2">No ECB summonses found</p>
          <p className="text-sm text-muted-foreground">No ECB summonses found for this property with the current filters.</p>
          {hasActiveFilters && <Button variant="link" onClick={handleClearFilters} className="mt-2">Clear filters and try again</Button>}
        </div>
      )}

      {items.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {isVisible('issueDate') && <TableHead className="font-semibold">Issue Date</TableHead>}
                {isVisible('status') && <TableHead className="font-semibold">Status</TableHead>}
                {isVisible('severity') && <TableHead className="font-semibold">Severity</TableHead>}
                {isVisible('category') && <TableHead className="font-semibold">Category</TableHead>}
                {isVisible('description') && <TableHead className="font-semibold">Description</TableHead>}
                {isVisible('penaltyAmount') && <TableHead className="font-semibold text-right">Penalty</TableHead>}
                {isVisible('balanceDue') && <TableHead className="font-semibold text-right">Balance</TableHead>}
                {isVisible('recordId') && <TableHead className="font-semibold">Record ID</TableHead>}
                {isVisible('amountPaid') && <TableHead className="font-semibold text-right">Paid</TableHead>}
                {isVisible('resolvedDate') && <TableHead className="font-semibold">Resolved</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow 
                  key={`${item.recordId}-${index}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(item)}
                >
                  {isVisible('issueDate') && <TableCell className="text-sm">{item.issueDate ? new Date(item.issueDate).toLocaleDateString() : '-'}</TableCell>}
                  {isVisible('status') && <TableCell><StatusBadge status={item.status} /></TableCell>}
                  {isVisible('severity') && <TableCell><SeverityBadge severity={item.severity} /></TableCell>}
                  {isVisible('category') && <TableCell className="text-sm">{item.category || '-'}</TableCell>}
                  {isVisible('description') && (
                    <TableCell className="max-w-xs">
                      {item.description ? (
                        <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="text-sm line-clamp-2 cursor-help">{item.description}</span></TooltipTrigger><TooltipContent className="max-w-md"><p>{item.description}</p></TooltipContent></Tooltip></TooltipProvider>
                      ) : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                  )}
                  {isVisible('penaltyAmount') && <TableCell className="text-right font-mono text-sm">{formatCurrency(item.penaltyAmount)}</TableCell>}
                  {isVisible('balanceDue') && <TableCell className="text-right font-mono text-sm"><span className={item.balanceDue && item.balanceDue > 0 ? 'text-destructive font-medium' : ''}>{formatCurrency(item.balanceDue)}</span></TableCell>}
                  {isVisible('recordId') && <TableCell><span className="font-mono text-sm">{item.recordId}</span></TableCell>}
                  {isVisible('amountPaid') && <TableCell className="text-right font-mono text-sm">{formatCurrency(item.amountPaid)}</TableCell>}
                  {isVisible('resolvedDate') && <TableCell className="text-sm">{item.resolvedDate ? new Date(item.resolvedDate).toLocaleDateString() : '-'}</TableCell>}
                </TableRow>
              ))}
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
        recordType="ecb"
        record={selectedRecord as unknown as Record<string, unknown>}
      />
    </div>
  );
}
