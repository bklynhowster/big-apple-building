import { ArrowLeft, Building2, Home, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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
}: ResultsContextRailProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 px-4 bg-card border border-border rounded-lg animate-fade-in">
      {/* Left: Address + Borough */}
      <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
        {isUnitMode ? (
          <Home className="h-5 w-5 text-primary shrink-0 mt-0.5 sm:mt-0" />
        ) : (
          <MapPin className="h-5 w-5 text-primary shrink-0 mt-0.5 sm:mt-0" />
        )}
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold text-foreground truncate leading-tight">
            {isUnitMode && unitLabel ? `Unit ${unitLabel}` : address || 'Property'}
          </h1>
          <p className="text-sm text-muted-foreground truncate">
            {isUnitMode ? address : ''} {isUnitMode && address ? '—' : ''} {borough || 'New York City'}
          </p>
        </div>
      </div>

      {/* Center: Identifier Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Building identifiers */}
        <Badge variant="outline" className="text-xs font-mono whitespace-nowrap">
          <Building2 className="h-3 w-3 mr-1" />
          BBL: {isUnitMode && buildingBbl ? buildingBbl : bbl || '—'}
        </Badge>
        {bin && (
          <Badge variant="outline" className="text-xs font-mono whitespace-nowrap">
            BIN: {bin}
          </Badge>
        )}
        
        {/* Unit identifiers (when in unit mode) */}
        {isUnitMode && unitBbl && (
          <Badge variant="secondary" className="text-xs font-mono whitespace-nowrap">
            <Home className="h-3 w-3 mr-1" />
            Unit BBL: {unitBbl}
          </Badge>
        )}
      </div>

      {/* Right: Back to Building button (unit mode only) */}
      {isUnitMode && onBackToBuilding && (
        <Button
          variant="outline"
          size="sm"
          onClick={onBackToBuilding}
          className="shrink-0 gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          <Building2 className="h-4 w-4" />
          <span className="hidden sm:inline">Building</span>
        </Button>
      )}
    </div>
  );
}
