import { useState } from 'react';
import { useSafety } from '@/hooks/useSafety';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { exportToCSV, SAFETY_COLUMNS } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';
import { ErrorBanner } from '@/components/ui/error-banner';
import { RecordDetailDrawer } from './RecordDetailDrawer';
import { ColumnSelector, useColumnVisibility, ColumnConfig } from './ColumnSelector';
import { QueriedIdentifier, DatasetCapability } from './QueriedIdentifier';
import { QueryScope } from './ScopeSelector';
import { BuildingLevelBanner } from './BuildingLevelBanner';

interface SafetyTabProps {
  bbl: string;
  bin?: string;
  scope?: QueryScope;
  isCoop?: boolean;
  coopUnitContext?: string | null;
}

interface SafetyViolation {
  recordType: 'Safety';
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  raw: Record<string, unknown>;
}

const COLUMN_CONFIGS: ColumnConfig[] = [
  { key: 'date', label: 'Date', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'category', label: 'Category', defaultVisible: true },
  { key: 'description', label: 'Description', defaultVisible: true },
  { key: 'recordId', label: 'Record ID', defaultVisible: true },
  { key: 'resolvedDate', label: 'Resolved Date', defaultVisible: false },
];

function StatusBadge({ status }: { status: 'open' | 'closed' | 'unknown' }) {
  const variants: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
    open: 'destructive', closed: 'secondary', unknown: 'outline',
  };
  return <Badge variant={variants[status] || 'outline'} className="capitalize">{status}</Badge>;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return 'N/A';
  try {
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return 'N/A'; }
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="border rounded-md">
        <div className="p-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      </div>
    </div>
  );
}

export function SafetyTab({ bbl, bin, scope = 'building', isCoop, coopUnitContext }: SafetyTabProps) {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;
  
  // Drawer state
  const [selectedRecord, setSelectedRecord] = useState<SafetyViolation | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  // Column visibility
  const { visibleColumns, toggle, reset, isVisible } = useColumnVisibility(COLUMN_CONFIGS);

  const { loading, error, data, refetch } = useSafety({
    bbl, limit, offset, status,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  });
  
  const handleRowClick = (record: SafetyViolation) => {
    setSelectedRecord(record);
    setDrawerOpen(true);
  };

  const handleStatusChange = (value: string) => {
    setStatus(value as 'open' | 'closed' | 'all');
    setOffset(0);
  };

  const handleDateChange = (type: 'from' | 'to', value: string) => {
    if (type === 'from') setFromDate(value);
    else setToDate(value);
    setOffset(0);
  };

  if (loading && !data) return <LoadingSkeleton />;
  if (error) return <div className="space-y-4"><ErrorBanner error={error} onRetry={refetch} retrying={loading} /></div>;

  const items = (data?.items || []) as SafetyViolation[];
  const totalApprox = data?.totalApprox || 0;

  const handleExportCSV = () => {
    if (items.length === 0) return;
    exportToCSV(items as unknown as Record<string, unknown>[], {
      filename: `safety_violations_${bbl}_${new Date().toISOString().split('T')[0]}.csv`,
      columns: SAFETY_COLUMNS,
    });
    toast({ title: 'Export complete', description: `Exported ${items.length} safety violations to CSV` });
  };

  // Dataset capability for Safety - BIN-based, building-level
  const datasetCapability: DatasetCapability = 'bin';

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
        datasetName="DOB Safety Violations"
      />
      
      <div className="flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="status-filter">Status</Label>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger id="status-filter" className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="from-date">From Date</Label>
          <Input id="from-date" type="date" value={fromDate} onChange={(e) => handleDateChange('from', e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to-date">To Date</Label>
          <Input id="to-date" type="date" value={toDate} onChange={(e) => handleDateChange('to', e.target.value)} className="w-40" />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Showing {items.length} of {totalApprox} safety violations{loading && ' (updating...)'}</p>
        <div className="flex items-center gap-2">
          <ColumnSelector columns={COLUMN_CONFIGS} visibleColumns={visibleColumns} onToggle={toggle} onReset={reset} />
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={items.length === 0 || loading} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />Export CSV
          </Button>
        </div>
      </div>

      {items.length === 0 && !loading && (
        <Alert><AlertCircle className="h-4 w-4" /><AlertDescription>No safety violations found for this property with current filters.</AlertDescription></Alert>
      )}

      {items.length > 0 && (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                {isVisible('date') && <TableHead>Date</TableHead>}
                {isVisible('status') && <TableHead>Status</TableHead>}
                {isVisible('category') && <TableHead>Category</TableHead>}
                {isVisible('description') && <TableHead>Description</TableHead>}
                {isVisible('recordId') && <TableHead>Record ID</TableHead>}
                {isVisible('resolvedDate') && <TableHead>Resolved Date</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow 
                  key={item.recordId} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleRowClick(item)}
                >
                  {isVisible('date') && <TableCell className="whitespace-nowrap">{formatDate(item.issueDate)}</TableCell>}
                  {isVisible('status') && <TableCell><StatusBadge status={item.status} /></TableCell>}
                  {isVisible('category') && <TableCell>{item.category || 'N/A'}</TableCell>}
                  {isVisible('description') && <TableCell className="max-w-xs"><span className="line-clamp-2">{item.description || 'No description available'}</span></TableCell>}
                  {isVisible('recordId') && <TableCell className="font-mono text-sm">{item.recordId}</TableCell>}
                  {isVisible('resolvedDate') && <TableCell className="whitespace-nowrap">{formatDate(item.resolvedDate)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalApprox > limit && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0 || loading}><ChevronLeft className="h-4 w-4 mr-1" />Previous</Button>
          <span className="text-sm text-muted-foreground">Page {Math.floor(offset / limit) + 1} of {Math.ceil(totalApprox / limit)}</span>
          <Button variant="outline" size="sm" onClick={() => setOffset(offset + limit)} disabled={!data?.nextOffset || loading}>Next<ChevronRight className="h-4 w-4 ml-1" /></Button>
        </div>
      )}
      
      {/* Record Detail Drawer */}
      <RecordDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        recordType="safety"
        record={selectedRecord as unknown as Record<string, unknown>}
      />
    </div>
  );
}
