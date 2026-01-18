import React from 'react';
import { FileSearch, ArrowLeft, Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface UnitMentionsHeaderProps {
  /** The unit label (e.g., "1A", "2C") */
  unitLabel: string;
  /** Number of records mentioning this unit */
  mentionCount: number;
  /** Handler to clear filter and view all building records */
  onViewAllRecords: () => void;
}

/**
 * Header shown when Records tab is filtered to show only records mentioning a specific unit.
 * Displays "Records mentioning Unit X (N)" with a link to view all building records.
 */
export function UnitMentionsHeader({
  unitLabel,
  mentionCount,
  onViewAllRecords,
}: UnitMentionsHeaderProps) {
  return (
    <div className="space-y-3">
      {/* Main header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <FileSearch className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              Records mentioning Unit {unitLabel}
              <Badge variant="secondary" className="font-mono">
                {mentionCount}
              </Badge>
            </h2>
            <p className="text-sm text-muted-foreground">
              Filtered to records that explicitly reference this unit
            </p>
          </div>
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewAllRecords}
          className="gap-2 text-muted-foreground hover:text-foreground"
        >
          <Building2 className="h-4 w-4" />
          View all building records
        </Button>
      </div>
      
      {/* Disclaimer */}
      <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 py-2">
        <FileSearch className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-xs text-amber-800 dark:text-amber-200">
          <strong>Unit mentions are inferred from text</strong> — not proof of unit-level enforcement. 
          All records remain building-level.
        </AlertDescription>
      </Alert>
    </div>
  );
}
