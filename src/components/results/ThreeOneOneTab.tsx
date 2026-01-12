import { useState, useEffect } from 'react';
import { Search, X, Loader2, FileX, Download, Info, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import { use311, ServiceRequestFilters, ServiceRequestRecord } from '@/hooks/use311';
import { exportToCSV } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';
import { ErrorBanner } from '@/components/ui/error-banner';
import { RecordDetailDrawer } from './RecordDetailDrawer';
import { ColumnSelector, useColumnVisibility, ColumnConfig } from './ColumnSelector';
import { QueriedIdentifier, DatasetCapability } from './QueriedIdentifier';
import { QueryScope } from './ScopeSelector';

interface ThreeOneOneTabProps {
  lat?: number;
  lon?: number;
  scope?: QueryScope;
}

const COLUMN_CONFIGS: ColumnConfig[] = [
  { key: 'date', label: 'Date', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'type', label: 'Type', defaultVisible: true },
  { key: 'description', label: 'Description', defaultVisible: true },
  { key: 'agency', label: 'Agency', defaultVisible: true },
];

function StatusBadge({ status }: { status: 'open' | 'closed' | 'unknown' }) {
  const variants: Record<string, 'destructive' | 'secondary' | 'outline'> = {
    open: 'destructive',
    closed: 'secondary',
    unknown: 'outline',
  };
  return <Badge variant={variants[status] || 'outline'} className="font-medium capitalize">{status}</Badge>;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
        <Skeleton className="h-10 flex-1" />
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-20" />
        </div>
      </div>
      <Skeleton className="h-6 w-64" />
      <div className="rounded-md border p-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

const COLUMNS = [
  { key: 'issueDate', header: 'Date' },
  { key: 'status', header: 'Status' },
  { key: 'category', header: 'Type' },
  { key: 'description', header: 'Description' },
  { key: 'agency', header: 'Agency' },
  { key: 'recordId', header: 'ID' },
];

export function ThreeOneOneTab({ lat, lon, scope = 'building' }: ThreeOneOneTabProps) {
  const { loading, error, data, items, fetch, filters, setFilters, applyFilters, retry } = use311(lat, lon);
  const [localFilters, setLocalFilters] = useState<ServiceRequestFilters>({
    status: 'all',
    keyword: '',
    radiusMeters: 250,
    fromDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  });
  
  // Drawer state
  const [selectedRecord, setSelectedRecord] = useState<ServiceRequestRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // Column visibility
  const { visibleColumns, toggle, reset, isVisible } = useColumnVisibility(COLUMN_CONFIGS);

  useEffect(() => {
    if (lat !== undefined && lon !== undefined && !isNaN(lat) && !isNaN(lon)) {
      fetch(lat, lon);
    }
  }, [lat, lon]);

  const handleApply = () => {
    setFilters(localFilters);
    if (lat !== undefined && lon !== undefined) {
      fetch(lat, lon);
    }
  };
  
  const handleRowClick = (record: ServiceRequestRecord) => {
    setSelectedRecord(record);
    setDrawerOpen(true);
  };

  if (!lat || !lon || isNaN(lat) || isNaN(lon)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
        <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-foreground font-medium mb-2">Coordinates not available</p>
        <p className="text-sm text-muted-foreground">311 data requires property coordinates (latitude/longitude).</p>
      </div>
    );
  }

  if (loading && !data) return <LoadingSkeleton />;
  if (error) return <ErrorBanner error={error} onRetry={retry} retrying={loading} />;

  const hasActiveFilters = localFilters.status !== 'all' || localFilters.keyword || localFilters.radiusMeters !== 250;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted/30 rounded-lg">
        <Info className="h-4 w-4 flex-shrink-0" />
        <span>Nearby 311 service requests within <strong>{data?.radiusMeters || localFilters.radiusMeters}m</strong> of property coordinates.</span>
      </div>

      <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by complaint type..."
            value={localFilters.keyword || ''}
            onChange={(e) => setLocalFilters(f => ({ ...f, keyword: e.target.value }))}
            className="pl-9 bg-card"
          />
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 min-w-[180px]">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Radius:</span>
            <Slider
              value={[localFilters.radiusMeters || 250]}
              onValueChange={([v]) => setLocalFilters(f => ({ ...f, radiusMeters: v }))}
              min={50}
              max={1000}
              step={50}
              className="w-24"
            />
            <span className="text-sm font-medium w-12">{localFilters.radiusMeters}m</span>
          </div>
          <Select value={localFilters.status} onValueChange={(v) => setLocalFilters(f => ({ ...f, status: v as ServiceRequestFilters['status'] }))}>
            <SelectTrigger className="w-32 bg-card"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={localFilters.fromDate || ''} onChange={(e) => setLocalFilters(f => ({ ...f, fromDate: e.target.value || undefined }))} className="w-36 bg-card" />
          <Button onClick={handleApply} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={() => setLocalFilters({ status: 'all', keyword: '', radiusMeters: 250 })}>
              <X className="h-4 w-4 mr-1" />Clear
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>Showing {items.length} of ~{data?.totalApprox || 0} nearby 311 requests</div>
        <div className="flex items-center gap-2">
          <ColumnSelector columns={COLUMN_CONFIGS} visibleColumns={visibleColumns} onToggle={toggle} onReset={reset} />
          <Button variant="outline" size="sm" onClick={() => { exportToCSV(items as unknown as Record<string, unknown>[], { filename: `311_requests_${lat}_${lon}.csv`, columns: COLUMNS }); toast({ title: 'Exported' }); }} disabled={items.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1" />Export
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
          <FileX className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-foreground font-medium mb-2">No 311 requests found nearby</p>
          <p className="text-sm text-muted-foreground">Try expanding the radius or date range.</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {isVisible('date') && <TableHead>Date</TableHead>}
                {isVisible('status') && <TableHead>Status</TableHead>}
                {isVisible('type') && <TableHead>Type</TableHead>}
                {isVisible('description') && <TableHead>Description</TableHead>}
                {isVisible('agency') && <TableHead>Agency</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, i) => (
                <TableRow 
                  key={`${item.recordId}-${i}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(item)}
                >
                  {isVisible('date') && <TableCell className="text-sm">{item.issueDate ? new Date(item.issueDate).toLocaleDateString() : '-'}</TableCell>}
                  {isVisible('status') && <TableCell><StatusBadge status={item.status} /></TableCell>}
                  {isVisible('type') && <TableCell className="text-sm">{item.category || '-'}</TableCell>}
                  {isVisible('description') && (
                    <TableCell className="max-w-xs">
                      <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="text-sm line-clamp-2 cursor-help">{item.description || '-'}</span></TooltipTrigger><TooltipContent className="max-w-md"><p>{item.description}</p></TooltipContent></Tooltip></TooltipProvider>
                    </TableCell>
                  )}
                  {isVisible('agency') && <TableCell className="text-sm">{item.agency || '-'}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      
      {/* Record Detail Drawer */}
      <RecordDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        recordType="311"
        record={selectedRecord as unknown as Record<string, unknown>}
      />
    </div>
  );
}
