import { ArrowLeft, Building2, Home, MapPin, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ReactNode } from 'react';

interface ResultsContextRailProps {
  address: string;
  borough: string;
  bbl: string;
  bin: string;
  unitLabel?: string | null;
  unitBbl?: string | null;
  buildingBbl?: string;
  isUnitMode: boolean;
  onBackToBuilding?: () => void;
  /** Building context content to show in collapsible (Unit Mode only) */
  buildingContextContent?: ReactNode;
  /** Current view scope */
  viewScope?: 'unit' | 'building';
  /** Handler for view scope toggle */
  onViewScopeChange?: (scope: 'unit' | 'building') => void;
}

export function ResultsContextRail({
  address,
  borough,
  bbl,
  bin,
  unitLabel,
  unitBbl,
  buildingBbl,
  isUnitMode,
  onBackToBuilding,
  buildingContextContent,
  viewScope = 'unit',
  onViewScopeChange,
}: ResultsContextRailProps) {
  return (
    <div className="bg-card border border-border rounded-lg animate-fade-in overflow-hidden">
      {/* Main Rail Content */}
      <div className="py-4 px-4 sm:px-5">
        {/* Unit Mode: Enhanced header layout */}
        {isUnitMode ? (
          <div className="space-y-4">
            {/* Top row: Back to Building link */}
            {onBackToBuilding && (
              <button
                onClick={onBackToBuilding}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group"
              >
                <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
                <span>Back to Building</span>
              </button>
            )}
            
            {/* Main header row */}
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              {/* Left: Large unit title + address */}
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg shrink-0">
                  <Home className="h-6 w-6 text-primary" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">
                    {unitLabel ? `Unit ${unitLabel}` : 'Unit'}
                  </h1>
                  <p className="text-sm sm:text-base text-muted-foreground mt-0.5 truncate">
                    {address ? `${address} — ${borough || 'New York City'}` : borough || 'New York City'}
                  </p>
                </div>
              </div>

              {/* Right: Context chips */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {unitBbl && (
                  <Badge variant="secondary" className="text-xs font-mono whitespace-nowrap">
                    <Home className="h-3 w-3 mr-1" />
                    Unit BBL: {unitBbl}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs font-mono whitespace-nowrap">
                  <Building2 className="h-3 w-3 mr-1" />
                  Building: {buildingBbl || bbl || '—'}
                </Badge>
                {bin && (
                  <Badge variant="outline" className="text-xs font-mono whitespace-nowrap">
                    BIN: {bin}
                  </Badge>
                )}
              </div>
            </div>
            
            {/* Inline view toggle */}
            {onViewScopeChange && (
              <div className="flex items-center gap-3 pt-2 border-t border-border mt-4">
                <span className="text-sm text-muted-foreground">Viewing:</span>
                <ToggleGroup 
                  type="single" 
                  value={viewScope} 
                  onValueChange={(v) => v && onViewScopeChange(v as 'unit' | 'building')}
                  className="bg-muted/50 p-0.5 rounded-md"
                >
                  <ToggleGroupItem 
                    value="unit" 
                    aria-label="Unit view" 
                    className="gap-1.5 px-3 py-1.5 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm rounded"
                  >
                    <Home className="h-3.5 w-3.5" />
                    Unit
                  </ToggleGroupItem>
                  <ToggleGroupItem 
                    value="building" 
                    aria-label="Building view" 
                    className="gap-1.5 px-3 py-1.5 text-sm data-[state=on]:bg-background data-[state=on]:shadow-sm rounded"
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    Building
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            )}
          </div>
        ) : (
          /* Building Mode: Original compact layout */
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* Left: Address + Borough */}
            <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
              <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5 sm:mt-0" />
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-semibold text-foreground truncate leading-tight">
                  {address || 'Property'}
                </h1>
                <p className="text-sm text-muted-foreground truncate">
                  {borough || 'New York City'}
                </p>
              </div>
            </div>

            {/* Center: Identifier Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs font-mono whitespace-nowrap">
                <Building2 className="h-3 w-3 mr-1" />
                BBL: {bbl || '—'}
              </Badge>
              {bin && (
                <Badge variant="outline" className="text-xs font-mono whitespace-nowrap">
                  BIN: {bin}
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Building Context Accordion - Unit Mode Only */}
      {isUnitMode && buildingContextContent && (
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className="w-full border-t border-border">
            <div className="py-2.5 px-4 sm:px-5 flex items-center justify-between hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Building Context</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 sm:px-5 pb-4 pt-2 border-t border-border space-y-4">
              {buildingContextContent}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
