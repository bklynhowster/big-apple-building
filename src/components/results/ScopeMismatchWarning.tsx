import { AlertTriangle, Building2, Home } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ScopeMismatchWarningProps {
  expectedCount: number;
  actualCount: number;
  currentScope: 'building' | 'unit';
  onSwitchScope?: () => void;
  datasetName?: string;
}

export function ScopeMismatchWarning({
  expectedCount,
  actualCount,
  currentScope,
  onSwitchScope,
  datasetName = 'records',
}: ScopeMismatchWarningProps) {
  // Only show if we expected records but got none
  if (expectedCount <= 0 || actualCount > 0) {
    return null;
  }

  const alternateScope = currentScope === 'building' ? 'unit' : 'building';
  const AlternateIcon = currentScope === 'building' ? Home : Building2;

  return (
    <Alert className="mb-4 border-warning/50 bg-warning/5">
      <AlertTriangle className="h-4 w-4 text-warning" />
      <AlertDescription className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">
            The snapshot indicates <strong>{expectedCount}</strong> {datasetName} exist, but none were returned for the selected scope.
          </span>
          <Badge variant="outline" className="text-xs">
            {currentScope === 'building' ? 'Building view' : 'Unit view'}
          </Badge>
        </div>
        {onSwitchScope && (
          <Button
            variant="outline"
            size="sm"
            onClick={onSwitchScope}
            className="gap-1.5 shrink-0"
          >
            <AlternateIcon className="h-3.5 w-3.5" />
            Try {alternateScope} view
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

interface BuildingScopeIndicatorProps {
  scope: 'building' | 'unit';
}

export function BuildingScopeIndicator({ scope }: BuildingScopeIndicatorProps) {
  if (scope !== 'building') {
    return null;
  }

  return (
    <div className="flex items-center gap-2 mb-3">
      <Badge variant="secondary" className="gap-1.5 text-xs">
        <Building2 className="h-3 w-3" />
        Building-level data shown
      </Badge>
    </div>
  );
}