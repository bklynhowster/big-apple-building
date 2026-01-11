import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { DataTable, StatusBadge } from './DataTable';
import { Badge } from '@/components/ui/badge';
import type { ECBViolation, SearchFilters } from '@/types/property';

interface ECBTabProps {
  violations: ECBViolation[];
}

function SeverityBadge({ severity }: { severity: ECBViolation['severity'] }) {
  const variants: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
    HAZARDOUS: 'destructive',
    MAJOR: 'default',
    MINOR: 'secondary',
    UNKNOWN: 'outline',
  };

  return (
    <Badge variant={variants[severity] || 'outline'} className="font-medium">
      {severity}
    </Badge>
  );
}

export function ECBTab({ violations }: ECBTabProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    status: 'all',
    keyword: '',
  });

  const columns = [
    {
      key: 'ecbNumber',
      header: 'ECB #',
      sortable: true,
      render: (item: ECBViolation) => (
        <span className="font-mono text-sm">{item.ecbNumber}</span>
      ),
    },
    {
      key: 'issueDate',
      header: 'Issue Date',
      sortable: true,
      render: (item: ECBViolation) => (
        <span className="text-sm">{new Date(item.issueDate).toLocaleDateString()}</span>
      ),
    },
    {
      key: 'violationType',
      header: 'Type',
      sortable: true,
    },
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      render: (item: ECBViolation) => <SeverityBadge severity={item.severity} />,
    },
    {
      key: 'description',
      header: 'Description',
      render: (item: ECBViolation) => (
        <span className="text-sm line-clamp-2">{item.description}</span>
      ),
    },
    {
      key: 'penaltyAmount',
      header: 'Penalty',
      sortable: true,
      render: (item: ECBViolation) => (
        <span className="text-sm font-mono">
          {item.penaltyAmount ? `$${item.penaltyAmount.toLocaleString()}` : '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (item: ECBViolation) => <StatusBadge status={item.status} />,
    },
  ];

  const filterFn = (item: ECBViolation, filters: SearchFilters) => {
    if (filters.status !== 'all') {
      const matchStatus = filters.status === 'open' ? 'OPEN' : 'RESOLVED';
      if (item.status !== matchStatus) return false;
    }
    
    if (filters.keyword) {
      const keyword = filters.keyword.toLowerCase();
      const searchable = `${item.ecbNumber} ${item.violationType} ${item.description}`.toLowerCase();
      if (!searchable.includes(keyword)) return false;
    }
    
    if (filters.dateFrom) {
      if (new Date(item.issueDate) < new Date(filters.dateFrom)) return false;
    }
    
    if (filters.dateTo) {
      if (new Date(item.issueDate) > new Date(filters.dateTo)) return false;
    }
    
    return true;
  };

  return (
    <div className="space-y-4">
      <FilterBar filters={filters} onFiltersChange={setFilters} />
      <DataTable
        data={violations}
        columns={columns}
        filters={filters}
        filterFn={filterFn}
        emptyMessage="No ECB violations found for this property"
      />
    </div>
  );
}
