import { Check, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ColumnConfig {
  key: string;
  label: string;
  defaultVisible?: boolean;
}

interface ColumnSelectorProps {
  columns: ColumnConfig[];
  visibleColumns: Set<string>;
  onToggle: (key: string) => void;
  onReset?: () => void;
}

export function ColumnSelector({ columns, visibleColumns, onToggle, onReset }: ColumnSelectorProps) {
  const allVisible = columns.every(col => visibleColumns.has(col.key));
  const someHidden = columns.some(col => !visibleColumns.has(col.key));
  
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Columns3 className="h-3.5 w-3.5" />
          Columns
          {someHidden && (
            <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded">
              {visibleColumns.size}/{columns.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.key}
            checked={visibleColumns.has(col.key)}
            onCheckedChange={() => onToggle(col.key)}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
        {onReset && someHidden && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={false}
              onCheckedChange={onReset}
              className="text-muted-foreground"
            >
              Reset to default
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Hook to manage column visibility state
import { useState, useCallback, useMemo } from 'react';

export function useColumnVisibility(columns: ColumnConfig[]) {
  const defaultVisible = useMemo(() => {
    return new Set(columns.filter(c => c.defaultVisible !== false).map(c => c.key));
  }, [columns]);
  
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(defaultVisible);
  
  const toggle = useCallback((key: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  
  const reset = useCallback(() => {
    setVisibleColumns(defaultVisible);
  }, [defaultVisible]);
  
  const isVisible = useCallback((key: string) => visibleColumns.has(key), [visibleColumns]);
  
  return { visibleColumns, toggle, reset, isVisible };
}
