import { useState } from 'react';
import { useSafety } from '@/hooks/useSafety';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { AlertCircle, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

interface SafetyTabProps {
  bbl: string;
}

function StatusBadge({ status }: { status: 'open' | 'closed' | 'unknown' }) {
  const variants: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
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

function formatDate(dateString: string | null): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'N/A';
  }
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
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SafetyTab({ bbl }: SafetyTabProps) {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [offset, setOffset] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const limit = 50;

  const { loading, error, data } = useSafety({
    bbl,
    limit,
    offset,
    status,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
  });

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const handleStatusChange = (value: string) => {
    setStatus(value as 'open' | 'closed' | 'all');
    setOffset(0);
  };

  const handleDateChange = (type: 'from' | 'to', value: string) => {
    if (type === 'from') {
      setFromDate(value);
    } else {
      setToDate(value);
    }
    setOffset(0);
  };

  if (loading && !data) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load safety violations: {error}
        </AlertDescription>
      </Alert>
    );
  }

  const items = data?.items || [];
  const totalApprox = data?.totalApprox || 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <Label htmlFor="status-filter">Status</Label>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger id="status-filter" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="from-date">From Date</Label>
          <Input
            id="from-date"
            type="date"
            value={fromDate}
            onChange={(e) => handleDateChange('from', e.target.value)}
            className="w-40"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="to-date">To Date</Label>
          <Input
            id="to-date"
            type="date"
            value={toDate}
            onChange={(e) => handleDateChange('to', e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        Showing {items.length} of {totalApprox} safety violations
        {loading && ' (updating...)'}
      </p>

      {/* Empty State */}
      {items.length === 0 && !loading && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No safety violations found for this property with current filters.
          </AlertDescription>
        </Alert>
      )}

      {/* Table */}
      {items.length > 0 && (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Record ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const isExpanded = expandedRows.has(item.recordId);
                return (
                  <>
                    <TableRow 
                      key={item.recordId} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleRow(item.recordId)}
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(item.issueDate)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>{item.category || 'N/A'}</TableCell>
                      <TableCell className="max-w-xs">
                        <span className={isExpanded ? '' : 'line-clamp-2'}>
                          {item.description || 'No description available'}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {item.recordId}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${item.recordId}-details`}>
                        <TableCell colSpan={6} className="bg-muted/30">
                          <div className="p-4 space-y-2">
                            <p className="text-sm">
                              <strong>Full Description:</strong> {item.description || 'N/A'}
                            </p>
                            <p className="text-sm">
                              <strong>Issue Date:</strong> {formatDate(item.issueDate)}
                            </p>
                            {item.resolvedDate && (
                              <p className="text-sm">
                                <strong>Resolved Date:</strong> {formatDate(item.resolvedDate)}
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalApprox > limit && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0 || loading}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {Math.floor(offset / limit) + 1} of {Math.ceil(totalApprox / limit)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(offset + limit)}
            disabled={!data?.nextOffset || loading}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
