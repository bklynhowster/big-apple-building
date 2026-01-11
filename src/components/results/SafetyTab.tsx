import { useState } from 'react';
import { FilterBar } from './FilterBar';
import { DataTable, StatusBadge } from './DataTable';
import { Badge } from '@/components/ui/badge';
import type { SafetyViolation, SearchFilters } from '@/types/property';

interface SafetyTabProps {
  violations: SafetyViolation[];
}

function ClassBadge({ violationClass }: { violationClass: SafetyViolation['class'] }) {
  const variants: Record<string, 'destructive' | 'default' | 'secondary' | 'outline'> = {
    A: 'outline',
    B: 'secondary',
    C: 'destructive',
    I: 'destructive',
  };

  const descriptions: Record<string, string> = {
    A: 'Non-hazardous',
    B: 'Hazardous',
    C: 'Immediately Hazardous',
    I: 'Immediately Hazardous',
  };

  return (
    <Badge variant={variants[violationClass] || 'outline'} className="font-medium">
      Class {violationClass}
    </Badge>
  );
}

export function SafetyTab({ violations }: SafetyTabProps) {
  const [filters, setFilters] = useState<SearchFilters>({
    status: 'all',
    keyword: '',
  });

  const columns = [
    {
      key: 'violationNumber',
      header: 'Violation #',
      sortable: true,
      render: (item: SafetyViolation) => (
        <span className="font-mono text-sm">{item.violationNumber}</span>
      ),
    },
    {
      key: 'issueDate',
      header: 'Issue Date',
      sortable: true,
      render: (item: SafetyViolation) => (
        <span className="text-sm">{new Date(item.issueDate).toLocaleDateString()}</span>
      ),
    },
    {
      key: 'class',
      header: 'Class',
      sortable: true,
      render: (item: SafetyViolation) => <ClassBadge violationClass={item.class} />,
    },
    {
      key: 'violationType',
      header: 'Type',
      sortable: true,
    },
    {
      key: 'description',
      header: 'Description',
      render: (item: SafetyViolation) => (
        <span className="text-sm line-clamp-2">{item.description}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (item: SafetyViolation) => <StatusBadge status={item.status} />,
    },
  ];

  const filterFn = (item: SafetyViolation, filters: SearchFilters) => {
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
        emptyMessage="No safety violations found for this property"
      />
    </div>
  );
}
