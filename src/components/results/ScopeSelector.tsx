import { Home, Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type QueryScope = 'unit' | 'building';

interface ScopeSelectorProps {
  scope: QueryScope;
  onScopeChange: (scope: QueryScope) => void;
  unitBbl: string | null;
  billingBbl: string | null;
  isCondoUnit: boolean;
}

export function ScopeSelector({ 
  scope, 
  onScopeChange, 
  unitBbl, 
  billingBbl,
  isCondoUnit 
}: ScopeSelectorProps) {
  // Only show if this is a condo situation (we have both unit and billing BBLs)
  if (!isCondoUnit || !billingBbl) return null;

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/50 border border-border rounded-lg">
      <span className="text-sm font-medium text-muted-foreground">Query Scope:</span>
      <ToggleGroup type="single" value={scope} onValueChange={(v) => v && onScopeChange(v as QueryScope)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToggleGroupItem value="unit" aria-label="Unit scope" className="gap-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <Home className="h-4 w-4" />
              Unit
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>
            <p>Query data for this specific unit only</p>
            {unitBbl && <p className="font-mono text-xs mt-1">BBL: {unitBbl}</p>}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToggleGroupItem value="building" aria-label="Building scope" className="gap-2 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
              <Building2 className="h-4 w-4" />
              Building
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>
            <p>Query data for the entire building</p>
            {billingBbl && <p className="font-mono text-xs mt-1">BBL: {billingBbl}</p>}
          </TooltipContent>
        </Tooltip>
      </ToggleGroup>
      
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Active:</span>
        <Badge variant="outline" className="font-mono text-xs">
          {scope === 'unit' ? unitBbl : billingBbl}
        </Badge>
      </div>
    </div>
  );
}
