import { Home, Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ContextIndicatorProps {
  unitLabel?: string | null;
  isUnitView: boolean;
  className?: string;
}

export function ContextIndicator({ 
  unitLabel, 
  isUnitView,
  className 
}: ContextIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Primary indicator - what we're viewing */}
      <Badge 
        variant="default" 
        className={cn(
          "gap-1.5 py-1.5 px-3 text-sm font-medium",
          isUnitView 
            ? "bg-primary text-primary-foreground" 
            : "bg-muted text-muted-foreground"
        )}
      >
        {isUnitView ? (
          <>
            <Home className="h-3.5 w-3.5" />
            Viewing: Unit {unitLabel || ''}
          </>
        ) : (
          <>
            <Building2 className="h-3.5 w-3.5" />
            Viewing: Building
          </>
        )}
      </Badge>
      
      {/* Secondary indicator - context shown */}
      {isUnitView && (
        <Badge 
          variant="outline" 
          className="gap-1.5 py-1.5 px-3 text-sm text-muted-foreground"
        >
          <Building2 className="h-3.5 w-3.5" />
          Building context shown below
        </Badge>
      )}
    </div>
  );
}
