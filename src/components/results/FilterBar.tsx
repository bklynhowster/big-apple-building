import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SearchFilters } from '@/types/property';

interface FilterBarProps {
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
}

export function FilterBar({ filters, onFiltersChange }: FilterBarProps) {
  const handleClear = () => {
    onFiltersChange({
      status: 'all',
      keyword: '',
      dateFrom: undefined,
      dateTo: undefined,
    });
  };

  const hasActiveFilters = 
    filters.status !== 'all' || 
    filters.keyword || 
    filters.dateFrom || 
    filters.dateTo;

  return (
    <div className="flex flex-col md:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
      <div className="flex-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by description or ID..."
            value={filters.keyword}
            onChange={(e) => onFiltersChange({ ...filters, keyword: e.target.value })}
            className="pl-9 bg-card"
          />
        </div>
      </div>
      
      <div className="flex flex-wrap gap-3">
        <Select
          value={filters.status}
          onValueChange={(v) => onFiltersChange({ ...filters, status: v as SearchFilters['status'] })}
        >
          <SelectTrigger className="w-32 bg-card">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>

        <Input
          type="date"
          placeholder="From"
          value={filters.dateFrom || ''}
          onChange={(e) => onFiltersChange({ ...filters, dateFrom: e.target.value || undefined })}
          className="w-36 bg-card"
        />

        <Input
          type="date"
          placeholder="To"
          value={filters.dateTo || ''}
          onChange={(e) => onFiltersChange({ ...filters, dateTo: e.target.value || undefined })}
          className="w-36 bg-card"
        />

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
