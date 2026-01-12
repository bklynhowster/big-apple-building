import { useState } from 'react';
import { Filter, X, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface UnitMentionFilterProps {
  /** All unique units mentioned in the dataset */
  allMentionedUnits: string[];
  /** Number of records that mention any unit */
  mentionCount: number;
  /** Total record count */
  totalCount: number;
  /** Currently selected unit filter */
  selectedUnit: string | null;
  /** Whether to show only records with mentions */
  showMentionsOnly: boolean;
  /** Current unit context (if set) */
  coopUnitContext?: string | null;
  /** Whether to filter to context matches only */
  showContextOnly: boolean;
  /** Callbacks */
  onUnitChange: (unit: string | null) => void;
  onMentionsOnlyChange: (value: boolean) => void;
  onContextOnlyChange: (value: boolean) => void;
}

export function UnitMentionFilter({
  allMentionedUnits,
  mentionCount,
  totalCount,
  selectedUnit,
  showMentionsOnly,
  coopUnitContext,
  showContextOnly,
  onUnitChange,
  onMentionsOnlyChange,
  onContextOnlyChange,
}: UnitMentionFilterProps) {
  const hasContext = !!coopUnitContext;
  const hasMentions = mentionCount > 0;
  
  if (!hasMentions && !hasContext) {
    return null;
  }
  
  return (
    <div className="space-y-3">
      {/* Disclaimer banner */}
      <Alert className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 py-2">
        <Users className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-xs text-amber-800 dark:text-amber-200">
          <strong>Unit mentions are inferred from text</strong> — not proof of unit-level enforcement. 
          All records remain building-level.
        </AlertDescription>
      </Alert>
      
      <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/30 rounded-lg border border-border/50">
        {/* Mentions count */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{mentionCount}</strong> of {totalCount} mention units
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{mentionCount} records explicitly reference an apartment/unit in their text</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        {/* Toggle: Show mentions only */}
        {hasMentions && (
          <div className="flex items-center gap-2">
            <Switch
              id="mentions-only"
              checked={showMentionsOnly}
              onCheckedChange={onMentionsOnlyChange}
              disabled={!hasMentions}
            />
            <Label htmlFor="mentions-only" className="text-sm cursor-pointer">
              Only unit mentions
            </Label>
          </div>
        )}
        
        {/* Unit dropdown filter */}
        {hasMentions && !showMentionsOnly && (
          <div className="flex items-center gap-2">
            <Select
              value={selectedUnit || 'all'}
              onValueChange={(v) => onUnitChange(v === 'all' ? null : v)}
            >
              <SelectTrigger className="w-40 h-8 text-sm bg-card">
                <Filter className="h-3 w-3 mr-1" />
                <SelectValue placeholder="Filter by unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All units</SelectItem>
                {allMentionedUnits.map(unit => (
                  <SelectItem key={unit} value={unit}>
                    <span className="font-mono">{unit}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {selectedUnit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onUnitChange(null)}
                className="h-7 px-2"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
        
        {/* Context filter (when unit context is set) */}
        {hasContext && (
          <div className="flex items-center gap-2 pl-3 border-l border-border">
            <Switch
              id="context-only"
              checked={showContextOnly}
              onCheckedChange={onContextOnlyChange}
            />
            <Label htmlFor="context-only" className="text-sm cursor-pointer flex items-center gap-1.5">
              Context: <Badge variant="secondary" className="font-mono text-xs">{coopUnitContext}</Badge>
            </Label>
          </div>
        )}
      </div>
    </div>
  );
}
