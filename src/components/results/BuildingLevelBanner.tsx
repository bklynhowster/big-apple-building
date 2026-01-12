import { Info, Building2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border border-border/50 rounded-md px-3 py-2 mb-4">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span>
          Records shown are issued at the building level and may relate to common areas or shared systems.
          {coopUnitContext && (
            <span className="ml-1">
              (Viewing in context of <strong>{coopUnitContext}</strong>)
            </span>
          )}
        </span>
      </div>
    );
  }

  return (
    <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 mb-4">
      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
      <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
        Records shown are issued at the building level and may relate to common areas or shared systems.
        {coopUnitContext && (
          <span className="block mt-1 font-medium">
            Shown in context of {coopUnitContext}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Smaller inline label for summary cards on co-op properties
 */
export function BuildingLevelLabel({ coopUnitContext }: { coopUnitContext?: string | null }) {
  return (
    <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
      <span className="flex items-center gap-1">
        <Building2 className="h-3 w-3" />
        Building-level
      </span>
      {coopUnitContext && (
        <span className="text-[10px] block mt-0.5">
          Shown in context of {coopUnitContext}
        </span>
      )}
    </div>
  );
}
