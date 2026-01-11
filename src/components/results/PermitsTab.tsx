import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { DataTable, StatusBadge } from './DataTable';
import type { Permit, SearchFilters } from '@/types/property';

interface PermitsTabProps {
  permits: Permit[];
}

export function PermitsTab({ permits }: PermitsTabProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    status: 'all',
    keyword: '',
  });

  const columns = [
    {
      key: 'jobNumber',
      header: 'Job #',
      sortable: true,
      render: (item: Permit) => (
        <span className="font-mono text-sm">{item.jobNumber}</span>
      ),
    },
    {
      key: 'filingDate',
      header: 'Filing Date',
      sortable: true,
      render: (item: Permit) => (
        <span className="text-sm">{new Date(item.filingDate).toLocaleDateString()}</span>
      ),
    },
    {
      key: 'permitType',
      header: 'Permit Type',
      sortable: true,
    },
    {
      key: 'workType',
      header: 'Work Type',
      sortable: true,
    },
    {
      key: 'description',
      header: 'Description',
      render: (item: Permit) => (
        <span className="text-sm line-clamp-2">{item.description}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (item: Permit) => <StatusBadge status={item.status} />,
    },
    {
      key: 'expirationDate',
      header: 'Expiration',
      sortable: true,
      render: (item: Permit) => (
        <span className="text-sm">
          {item.expirationDate ? new Date(item.expirationDate).toLocaleDateString() : '-'}
        </span>
      ),
    },
  ];

  const filterFn = (item: Permit, filters: SearchFilters) => {
    if (filters.status !== 'all') {
      if (filters.status === 'open') {
        if (!['ISSUED', 'PENDING'].includes(item.status)) return false;
      } else {
        if (!['COMPLETED', 'EXPIRED'].includes(item.status)) return false;
      }
    }
    
    if (filters.keyword) {
      const keyword = filters.keyword.toLowerCase();
      const searchable = `${item.jobNumber} ${item.permitType} ${item.workType} ${item.description}`.toLowerCase();
      if (!searchable.includes(keyword)) return false;
    }
    
    if (filters.dateFrom) {
      if (new Date(item.filingDate) < new Date(filters.dateFrom)) return false;
    }
    
    if (filters.dateTo) {
      if (new Date(item.filingDate) > new Date(filters.dateTo)) return false;
    }
    
    return true;
  };

  return (
    <div className="space-y-4">
      <FilterBar filters={filters} onFiltersChange={setFilters} />
      <DataTable
        data={permits}
        columns={columns}
        filters={filters}
        filterFn={filterFn}
        emptyMessage="No permits found for this property"
      />
    </div>
  );
}
