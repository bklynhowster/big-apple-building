import { Calendar, Building2, Users, Layers, Maximize2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface BuildingSummaryStripProps {
  yearBuilt?: number | null;
  buildingClass?: string | null;
  totalUnits?: number | null;
  residentialUnits?: number | null;
  numFloors?: number | null;
  grossSqFt?: number | null;
  propertyTypeLabel?: string | null;
  loading?: boolean;
}

function StatItem({ 
  icon: Icon, 
  label, 
  value, 
  tooltip 
}: { 
  icon: React.ElementType; 
  label: string; 
  value: string | number | null | undefined; 
  tooltip?: string;
}) {
  const displayValue = value ?? '—';
  
  const content = (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground tabular-nums">{displayValue}</span>
    </div>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">{content}</div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

export function BuildingSummaryStrip({
  yearBuilt,
  buildingClass,
  totalUnits,
  residentialUnits,
  numFloors,
  grossSqFt,
  propertyTypeLabel,
  loading = false,
}: BuildingSummaryStripProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading building info...</span>
      </div>
    );
  }

  // Don't show if no data available
  const hasData = yearBuilt || buildingClass || totalUnits || numFloors;
  if (!hasData) {
    return null;
  }

  // Format gross sq ft
  const formattedSqFt = grossSqFt 
    ? grossSqFt >= 1000 
      ? `${(grossSqFt / 1000).toFixed(0)}K` 
      : grossSqFt.toLocaleString()
    : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2 border-t border-border/50 mt-2">
      {propertyTypeLabel && propertyTypeLabel !== 'Unknown' && (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 h-5">
          {propertyTypeLabel}
        </Badge>
      )}
      
      {yearBuilt && (
        <StatItem 
          icon={Calendar} 
          label="Built" 
          value={yearBuilt} 
        />
      )}
      
      {buildingClass && (
        <StatItem 
          icon={Building2} 
          label="Class" 
          value={buildingClass}
          tooltip="NYC DOF Building Classification Code"
        />
      )}
      
      {(totalUnits || residentialUnits) && (
        <StatItem 
          icon={Users} 
          label="Units" 
          value={residentialUnits ?? totalUnits}
          tooltip={residentialUnits && totalUnits && residentialUnits !== totalUnits 
            ? `${residentialUnits} residential / ${totalUnits} total`
            : undefined
          }
        />
      )}
      
      {numFloors && (
        <StatItem 
          icon={Layers} 
          label="Floors" 
          value={numFloors} 
        />
      )}
      
      {formattedSqFt && (
        <StatItem 
          icon={Maximize2} 
          label="Gross SF" 
          value={formattedSqFt}
          tooltip={grossSqFt ? `${grossSqFt.toLocaleString()} square feet` : undefined}
        />
      )}
    </div>
  );
}