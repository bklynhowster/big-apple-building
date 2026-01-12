import { useState, useEffect } from 'react';
import { Search, X, ChevronLeft, ChevronRight, Loader2, FileX, Download, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHPDViolations, useHPDComplaints, HPDFilters, HPDViolationRecord, HPDComplaintRecord } from '@/hooks/useHPD';
import { exportToCSV } from '@/lib/csv-export';
import { toast } from '@/hooks/use-toast';
import { ErrorBanner } from '@/components/ui/error-banner';

interface HPDTabProps {
  bbl: string;
}

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

export function HPDTab({ bbl }: HPDTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'violations' | 'complaints'>('violations');
  const [fetchedTabs, setFetchedTabs] = useState<Set<string>>(new Set());
  
  const violations = useHPDViolations(bbl);
  const complaints = useHPDComplaints(bbl);

  const [localViolationFilters, setLocalViolationFilters] = useState<HPDFilters>({ status: 'all', keyword: '' });
  const [localComplaintFilters, setLocalComplaintFilters] = useState<HPDFilters>({ status: 'all', keyword: '' });

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

  const renderViolationsContent = () => {
    if (violations.loading && !violations.data) return <LoadingSkeleton />;
    if (violations.error) return <ErrorBanner error={violations.error} onRetry={violations.retry} retrying={violations.loading} />;

    const items = violations.items;
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
          <Button variant="outline" size="sm" onClick={() => { exportToCSV(items as unknown as Record<string, unknown>[], { filename: `hpd_violations_${bbl}.csv`, columns: HPD_COLUMNS }); toast({ title: 'Exported' }); }} disabled={items.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1" />Export
          </Button>
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
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, i) => (
                  <TableRow key={`${item.recordId}-${i}`}>
                    <TableCell className="text-sm">{item.issueDate ? new Date(item.issueDate).toLocaleDateString() : '-'}</TableCell>
                    <TableCell><StatusBadge status={item.status} /></TableCell>
                    <TableCell><ClassBadge violationClass={item.violationClass} /></TableCell>
                    <TableCell className="max-w-xs">
                      <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="text-sm line-clamp-2 cursor-help">{item.description || '-'}</span></TooltipTrigger><TooltipContent className="max-w-md"><p>{item.description}</p></TooltipContent></Tooltip></TooltipProvider>
                    </TableCell>
                    <TableCell><span className="font-mono text-sm">{item.recordId}</span></TableCell>
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

    const items = complaints.items;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>Showing {items.length} of ~{complaints.data?.totalApprox || 0} HPD complaints</div>
          <Button variant="outline" size="sm" onClick={() => { exportToCSV(items as unknown as Record<string, unknown>[], { filename: `hpd_complaints_${bbl}.csv`, columns: HPD_COLUMNS }); toast({ title: 'Exported' }); }} disabled={items.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1" />Export
          </Button>
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
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, i) => (
                  <TableRow key={`${item.recordId}-${i}`}>
                    <TableCell className="text-sm">{item.issueDate ? new Date(item.issueDate).toLocaleDateString() : '-'}</TableCell>
                    <TableCell><StatusBadge status={item.status} /></TableCell>
                    <TableCell className="text-sm">{item.category || '-'}</TableCell>
                    <TableCell className="max-w-xs">
                      <TooltipProvider><Tooltip><TooltipTrigger asChild><span className="text-sm line-clamp-2 cursor-help">{item.description || '-'}</span></TooltipTrigger><TooltipContent className="max-w-md"><p>{item.description}</p></TooltipContent></Tooltip></TooltipProvider>
                    </TableCell>
                    <TableCell><span className="font-mono text-sm">{item.recordId}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
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
    </div>
  );
}
