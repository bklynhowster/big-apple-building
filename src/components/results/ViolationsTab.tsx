import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { DataTable, StatusBadge } from './DataTable';
import type { DOBViolation, SearchFilters } from '@/types/property';

interface ViolationsTabProps {
  violations: DOBViolation[];
}

export function ViolationsTab({ violations }: ViolationsTabProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    status: 'all',
    keyword: '',
  });

  const columns = [
    {
      key: 'violationNumber',
      header: 'Violation #',
      sortable: true,
      render: (item: DOBViolation) => (
        <span className="font-mono text-sm">{item.violationNumber}</span>
      ),
    },
    {
      key: 'issueDate',
      header: 'Issue Date',
      sortable: true,
      render: (item: DOBViolation) => (
        <span className="text-sm">{new Date(item.issueDate).toLocaleDateString()}</span>
      ),
    },
    {
      key: 'violationType',
      header: 'Type',
      sortable: true,
    },
    {
      key: 'description',
      header: 'Description',
      render: (item: DOBViolation) => (
        <span className="text-sm line-clamp-2">{item.description}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (item: DOBViolation) => <StatusBadge status={item.status} />,
    },
    {
      key: 'dispositionDate',
      header: 'Disposition Date',
      sortable: true,
      render: (item: DOBViolation) => (
        <span className="text-sm">
          {item.dispositionDate ? new Date(item.dispositionDate).toLocaleDateString() : '-'}
        </span>
      ),
    },
  ];

  const filterFn = (item: DOBViolation, filters: SearchFilters) => {
    if (filters.status !== 'all') {
      const matchStatus = filters.status === 'open' ? 'OPEN' : 'RESOLVED';
      if (item.status !== matchStatus) return false;
    }
    
    if (filters.keyword) {
      const keyword = filters.keyword.toLowerCase();
      const searchable = `${item.violationNumber} ${item.violationType} ${item.description}`.toLowerCase();
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
        emptyMessage="No DOB violations found for this property"
      />
    </div>
  );
}
