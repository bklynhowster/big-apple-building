import { Info, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type DatasetCapability = 'unit-bbl' | 'building-bbl' | 'bin' | 'address' | 'geo';

interface QueriedIdentifierProps {
  bbl: string;
  bin?: string | null;
  scope: 'unit' | 'building';
  datasetCapability: DatasetCapability;
  datasetName: string;
}

const CAPABILITY_LABELS: Record<DatasetCapability, { label: string; description: string }> = {
  'unit-bbl': { label: 'Unit-capable (BBL)', description: 'This dataset supports querying by individual unit BBL' },
  'building-bbl': { label: 'Building-level (BBL)', description: 'This dataset only supports building-level BBL queries' },
  'bin': { label: 'Building-level (BIN)', description: 'This dataset is keyed by Building Identification Number (BIN)' },
  'address': { label: 'Address-based', description: 'This dataset is queried by address' },
  'geo': { label: 'Geographic (Lat/Lon)', description: 'This dataset is queried by geographic coordinates' },
};

export function QueriedIdentifier({ 
  bbl, 
  bin, 
  scope, 
  datasetCapability, 
  datasetName 
}: QueriedIdentifierProps) {
  const capability = CAPABILITY_LABELS[datasetCapability];
  const isBuildingLevel = datasetCapability === 'building-bbl' || datasetCapability === 'bin';
  const showMismatchWarning = scope === 'unit' && isBuildingLevel;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground mb-4 p-2 bg-muted/30 rounded border border-border/50">
      <Info className="h-4 w-4 flex-shrink-0" />
      
      <span>Queried identifier:</span>
      
      {datasetCapability === 'bin' && bin ? (
        <Badge variant="outline" className="font-mono text-xs">
          BIN {bin}
        </Badge>
      ) : datasetCapability === 'geo' ? (
        <Badge variant="outline" className="font-mono text-xs">
          Nearby coordinates
        </Badge>
      ) : (
        <Badge variant="outline" className="font-mono text-xs">
          BBL {bbl}
        </Badge>
      )}
      
      <Badge 
        variant={scope === 'unit' ? 'default' : 'secondary'} 
        className="text-xs"
      >
        {scope === 'unit' ? 'Unit' : 'Building'}
      </Badge>
      
      <span className="text-muted-foreground/70">|</span>
      
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`text-xs cursor-help ${isBuildingLevel ? 'border-amber-500/50 text-amber-600 dark:text-amber-400' : 'border-green-500/50 text-green-600 dark:text-green-400'}`}
          >
            {capability.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">{datasetName}</p>
          <p className="text-xs mt-1">{capability.description}</p>
        </TooltipContent>
      </Tooltip>
      
      {showMismatchWarning && (
        <div className="flex items-center gap-1.5 ml-auto text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="text-xs">Building-level data shown in Unit scope</span>
        </div>
      )}
    </div>
  );
}
