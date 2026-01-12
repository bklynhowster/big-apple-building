import { Info, Building2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

interface BuildingLevelBannerProps {
  coopUnitContext?: string | null;
  compact?: boolean;
}

/**
 * Info banner shown at the top of each tab when viewing a co-op property,
 * explaining that all records are building-level.
 */
export function BuildingLevelBanner({ coopUnitContext, compact = false }: BuildingLevelBannerProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap text-xs bg-muted/30 border border-border/50 rounded-md px-3 py-2 mb-4">
        <Badge variant="secondary" className="text-[10px] gap-1 py-0.5">
          <Building2 className="h-3 w-3" />
          Building-level (Co-op)
        </Badge>
        {coopUnitContext && (
          <Badge variant="outline" className="text-[10px] py-0.5">
            Apt context: {coopUnitContext} (context-only)
          </Badge>
        )}
        <span className="text-muted-foreground ml-auto">
          Records apply to the building and may relate to common areas or shared systems.
        </span>
      </div>
    );
  }

  return (
    <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 mb-4">
      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
      <AlertTitle className="text-sm font-medium text-blue-800 dark:text-blue-200 flex items-center gap-2">
        Building-level Records (Co-op)
        {coopUnitContext && (
          <Badge variant="outline" className="text-[10px] font-normal border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300">
            Apt context: {coopUnitContext} (context-only)
          </Badge>
        )}
      </AlertTitle>
      <AlertDescription className="text-sm text-blue-800/80 dark:text-blue-200/80 mt-1">
        NYC co-op apartments do not have individual BBLs. Records shown apply to the building and may relate to common areas or shared systems.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Smaller inline label for summary cards on co-op properties
 */
export function BuildingLevelLabel({ coopUnitContext }: { coopUnitContext?: string | null }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
      <Badge variant="secondary" className="text-[10px] gap-1 py-0.5 font-normal">
        <Building2 className="h-3 w-3" />
        Building-level
      </Badge>
      {coopUnitContext && (
        <span className="text-[10px]">
          Shown in context of <strong>{coopUnitContext}</strong>
        </span>
      )}
    </div>
  );
}
