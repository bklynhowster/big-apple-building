import { useState, useEffect, useMemo } from 'react';
import { Search, X, ChevronLeft, ChevronRight, Loader2, FileX, Download, Info, Home, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useHPDViolations, useHPDComplaints, HPDFilters, HPDViolationRecord, HPDComplaintRecord } from '@/hooks/useHPD';
import { exportToCSV } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';
import { ErrorBanner } from '@/components/ui/error-banner';
import { RecordDetailDrawer, RecordType } from './RecordDetailDrawer';
import { ColumnSelector, useColumnVisibility, ColumnConfig } from './ColumnSelector';
import { QueriedIdentifier, DatasetCapability } from './QueriedIdentifier';
import { QueryScope } from './ScopeSelector';
import { BuildingLevelBanner } from './BuildingLevelBanner';
import { filterRecordsByUnit } from '@/utils/unit';

interface HPDTabProps {
  bbl: string;
  bin?: string;
  scope?: QueryScope;
  isCoop?: boolean;
  coopUnitContext?: string | null;
  onClearUnitContext?: () => void;
  address?: string;
}

const VIOLATION_COLUMN_CONFIGS: ColumnConfig[] = [
  { key: 'date', label: 'Date', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'class', label: 'Class', defaultVisible: true },
  { key: 'description', label: 'Description', defaultVisible: true },
  { key: 'recordId', label: 'ID', defaultVisible: true },
];

const COMPLAINT_COLUMN_CONFIGS: ColumnConfig[] = [
  { key: 'date', label: 'Date', defaultVisible: true },
  { key: 'status', label: 'Status', defaultVisible: true },
  { key: 'category', label: 'Category', defaultVisible: true },
  { key: 'description', label: 'Description', defaultVisible: true },
  { key: 'recordId', label: 'ID', defaultVisible: true },
];

function StatusBadge({ status }: { status: 'open' | 'closed' | 'unknown' }) {
  const variants: Record<string, 'destructive' | 'secondary' | 'outline'> = {
    open: 'destructive',
    closed: 'secondary',
    unknown: 'outline',
  };
  return <Badge variant={variants[status] || 'outline'} className="font-medium capitalize">{status}</Badge>;
}

function ClassBadge({ violationClass }: { violationClass: string | null }) {
  if (!violationClass) return <span className="text-muted-foreground">-</span>;
  const colors: Record<string, string> = {
    'A': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'B': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    'C': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    'I': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[violationClass] || 'bg-muted text-muted-foreground'}`}>
      Class {violationClass}
    </span>
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

const HPD_COLUMNS = [
  { key: 'issueDate', header: 'Date' },
  { key: 'status', header: 'Status' },
  { key: 'category', header: 'Class' },
  { key: 'description', header: 'Description' },
  { key: 'recordId', header: 'ID' },
];

export function HPDTab({ bbl, bin, scope = 'building', isCoop, coopUnitContext, onClearUnitContext, address }: HPDTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'violations' | 'complaints'>('violations');
  const [fetchedTabs, setFetchedTabs] = useState<Set<string>>(new Set());
  
  // Drawer state
  const [selectedRecord, setSelectedRecord] = useState<HPDViolationRecord | HPDComplaintRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRecordType, setDrawerRecordType] = useState<RecordType>('hpd-violation');
  
  const violations = useHPDViolations(bbl);
  const complaints = useHPDComplaints(bbl);

  const [localViolationFilters, setLocalViolationFilters] = useState<HPDFilters>({ status: 'all', keyword: '' });
  const [localComplaintFilters, setLocalComplaintFilters] = useState<HPDFilters>({ status: 'all', keyword: '' });
  
  // Column visibility
  const violationColumns = useColumnVisibility(VIOLATION_COLUMN_CONFIGS);
  const complaintColumns = useColumnVisibility(COMPLAINT_COLUMN_CONFIGS);

  // Filter by unit context for co-ops (client-side filtering)
  const filteredViolations = useMemo(() => {
    if (!isCoop || !coopUnitContext) return violations.items;
    return filterRecordsByUnit(
      violations.items.map(item => ({ ...item, ...item.raw })),
      coopUnitContext
    ) as unknown as HPDViolationRecord[];
  }, [violations.items, isCoop, coopUnitContext]);

  const filteredComplaints = useMemo(() => {
    if (!isCoop || !coopUnitContext) return complaints.items;
    return filterRecordsByUnit(
      complaints.items.map(item => ({ ...item, ...item.raw })),
      coopUnitContext
    ) as unknown as HPDComplaintRecord[];
  }, [complaints.items, isCoop, coopUnitContext]);

  // Lazy-load: only fetch when subtab is first viewed
  useEffect(() => {
    if (!bbl || bbl.length !== 10) return;
    
    if (activeSubTab === 'violations' && !fetchedTabs.has('violations')) {
      violations.fetch(bbl);
      setFetchedTabs(prev => new Set(prev).add('violations'));
    } else if (activeSubTab === 'complaints' && !fetchedTabs.has('complaints')) {
      complaints.fetch(bbl);
      setFetchedTabs(prev => new Set(prev).add('complaints'));
    }
  }, [bbl, activeSubTab, fetchedTabs]);
  
  const handleViolationRowClick = (record: HPDViolationRecord) => {
    setSelectedRecord(record);
    setDrawerRecordType('hpd-violation');
    setDrawerOpen(true);
  };
  
  const handleComplaintRowClick = (record: HPDComplaintRecord) => {
    setSelectedRecord(record);
    setDrawerRecordType('hpd-complaint');
    setDrawerOpen(true);
  };

  const renderViolationsContent = () => {
    if (violations.loading && !violations.data) return <LoadingSkeleton />;
    if (violations.error) return <ErrorBanner error={violations.error} onRetry={violations.retry} retrying={violations.loading} />;

    const items = filteredViolations;
    const hasActiveFilters = localViolationFilters.status !== 'all' || localViolationFilters.keyword;

    return (
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search violations..."
              value={localViolationFilters.keyword || ''}
              onChange={(e) => setLocalViolationFilters(f => ({ ...f, keyword: e.target.value }))}
              className="pl-9 bg-card"
            />
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <Select value={localViolationFilters.status} onValueChange={(v) => setLocalViolationFilters(f => ({ ...f, status: v as HPDFilters['status'] }))}>
              <SelectTrigger className="w-32 bg-card"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={localViolationFilters.violationClass || 'all'} onValueChange={(v) => setLocalViolationFilters(f => ({ ...f, violationClass: v === 'all' ? undefined : v }))}>
              <SelectTrigger className="w-32 bg-card"><SelectValue placeholder="Class" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                <SelectItem value="A">Class A</SelectItem>
                <SelectItem value="B">Class B</SelectItem>
                <SelectItem value="C">Class C</SelectItem>
                <SelectItem value="I">Class I</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => { violations.setFilters(localViolationFilters); violations.applyFilters(); }} disabled={violations.loading}>
              {violations.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
            </Button>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={() => { setLocalViolationFilters({ status: 'all', keyword: '' }); violations.reset(); }}>
                <X className="h-4 w-4 mr-1" />Clear
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>Showing {items.length} of ~{violations.data?.totalApprox || 0} HPD violations</div>
          <div className="flex items-center gap-2">
            <ColumnSelector columns={VIOLATION_COLUMN_CONFIGS} visibleColumns={violationColumns.visibleColumns} onToggle={violationColumns.toggle} onReset={violationColumns.reset} />
            <Button variant="outline" size="sm" onClick={() => { exportToCSV(items as unknown as Record<string, unknown>[], { filename: `hpd_violations_${bbl}.csv`, columns: HPD_COLUMNS }); toast({ title: 'Exported' }); }} disabled={items.length === 0}>
              <Download className="h-3.5 w-3.5 mr-1" />Export
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
            <FileX className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-foreground font-medium mb-2">No HPD violations found</p>
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {violationColumns.isVisible('date') && <TableHead>Date</TableHead>}
                  {violationColumns.isVisible('status') && <TableHead>Status</TableHead>}
                  {violationColumns.isVisible('class') && <TableHead>Class</TableHead>}
                  {violationColumns.isVisible('description') && <TableHead>Description</TableHead>}
                  {violationColumns.isVisible('recordId') && <TableHead>ID</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, i) => (
                  <TableRow 
                    key={`${item.recordId}-${i}`}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleViolationRowClick(item)}
                  >
                    {violationColumns.isVisible('date') && <TableCell className="text-sm">{item.issueDate ? new Date(item.issueDate).toLocaleDateString() : '-'}</TableCell>}
                    {violationColumns.isVisible('status') && <TableCell><StatusBadge status={item.status} /></TableCell>}
                    {violationColumns.isVisible('class') && <TableCell><ClassBadge violationClass={item.violationClass} /></TableCell>}
                    {violationColumns.isVisible('description') && (
                      <TableCell className="max-w-xs">
                        <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="text-sm line-clamp-2 cursor-help">{item.description || '-'}</span></TooltipTrigger><TooltipContent className="max-w-md"><p>{item.description}</p></TooltipContent></Tooltip></TooltipProvider>
                      </TableCell>
                    )}
                    {violationColumns.isVisible('recordId') && <TableCell><span className="font-mono text-sm">{item.recordId}</span></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  };

  const renderComplaintsContent = () => {
    if (complaints.loading && !complaints.data) return <LoadingSkeleton />;
    if (complaints.error) return <ErrorBanner error={complaints.error} onRetry={complaints.retry} retrying={complaints.loading} />;

    const items = filteredComplaints;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>Showing {items.length} of ~{complaints.data?.totalApprox || 0} HPD complaints</div>
          <div className="flex items-center gap-2">
            <ColumnSelector columns={COMPLAINT_COLUMN_CONFIGS} visibleColumns={complaintColumns.visibleColumns} onToggle={complaintColumns.toggle} onReset={complaintColumns.reset} />
            <Button variant="outline" size="sm" onClick={() => { exportToCSV(items as unknown as Record<string, unknown>[], { filename: `hpd_complaints_${bbl}.csv`, columns: HPD_COLUMNS }); toast({ title: 'Exported' }); }} disabled={items.length === 0}>
              <Download className="h-3.5 w-3.5 mr-1" />Export
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg bg-muted/20">
            <FileX className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-foreground font-medium mb-2">No HPD complaints found</p>
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {complaintColumns.isVisible('date') && <TableHead>Date</TableHead>}
                  {complaintColumns.isVisible('status') && <TableHead>Status</TableHead>}
                  {complaintColumns.isVisible('category') && <TableHead>Category</TableHead>}
                  {complaintColumns.isVisible('description') && <TableHead>Description</TableHead>}
                  {complaintColumns.isVisible('recordId') && <TableHead>ID</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, i) => (
                  <TableRow 
                    key={`${item.recordId}-${i}`}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleComplaintRowClick(item)}
                  >
                    {complaintColumns.isVisible('date') && <TableCell className="text-sm">{item.issueDate ? new Date(item.issueDate).toLocaleDateString() : '-'}</TableCell>}
                    {complaintColumns.isVisible('status') && <TableCell><StatusBadge status={item.status} /></TableCell>}
                    {complaintColumns.isVisible('category') && <TableCell className="text-sm">{item.category || '-'}</TableCell>}
                    {complaintColumns.isVisible('description') && (
                      <TableCell className="max-w-xs">
                        <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="text-sm line-clamp-2 cursor-help">{item.description || '-'}</span></TooltipTrigger><TooltipContent className="max-w-md"><p>{item.description}</p></TooltipContent></Tooltip></TooltipProvider>
                      </TableCell>
                    )}
                    {complaintColumns.isVisible('recordId') && <TableCell><span className="font-mono text-sm">{item.recordId}</span></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  };

  // Dataset capability for HPD - BBL-based, building-level
  const datasetCapability: DatasetCapability = 'building-bbl';

  return (
    <div className="space-y-4">
      {/* Co-op building-level banner */}
      {isCoop && <BuildingLevelBanner coopUnitContext={coopUnitContext} compact />}
      
      {/* Unit context filter indicator for co-ops */}
      {isCoop && (
        <Alert className={coopUnitContext 
          ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30' 
          : 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30'
        }>
          {coopUnitContext ? (
            <Home className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          ) : (
            <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          )}
          <AlertDescription className="flex items-center justify-between w-full">
            <span className={coopUnitContext 
              ? 'text-amber-800 dark:text-amber-200' 
              : 'text-blue-800 dark:text-blue-200'
            }>
              {coopUnitContext 
                ? <>Showing records referencing <strong>Unit {coopUnitContext}</strong> (unit-referenced)</>
                : 'Showing building-wide records (no unit filter)'
              }
            </span>
            {coopUnitContext && onClearUnitContext && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onClearUnitContext}
                className="h-6 px-2 text-xs"
              >
                <X className="h-3 w-3 mr-1" />
                Clear filter
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      
      {/* Queried Identifier */}
      <QueriedIdentifier
        bbl={bbl}
        bin={bin}
        scope={scope}
        datasetCapability={datasetCapability}
        datasetName="HPD Violations & Complaints"
      />
      
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <Info className="h-4 w-4" />
        <span>HPD (Housing Preservation & Development) violations and complaints for this property.</span>
      </div>
      
      <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as 'violations' | 'complaints')}>
        <TabsList>
          <TabsTrigger value="violations">Violations ({violations.data?.totalApprox || 0})</TabsTrigger>
          <TabsTrigger value="complaints">Complaints ({complaints.data?.totalApprox || 0})</TabsTrigger>
        </TabsList>
        <TabsContent value="violations" className="mt-4">{renderViolationsContent()}</TabsContent>
        <TabsContent value="complaints" className="mt-4">{renderComplaintsContent()}</TabsContent>
      </Tabs>
      
      {/* Record Detail Drawer */}
      <RecordDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        recordType={drawerRecordType}
        record={selectedRecord as unknown as Record<string, unknown>}
        address={address}
      />
    </div>
  );
}
