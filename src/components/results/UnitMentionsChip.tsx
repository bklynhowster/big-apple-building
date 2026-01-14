import { Users, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface UnitMentionsChipProps {
  totalMentions: number;
  onClick?: () => void;
  loading?: boolean;
}

/**
 * A chip that displays the total number of unit mentions found across all datasets.
 * Appears near Risk Snapshot when totalMentions > 0.
 */
export function UnitMentionsChip({ totalMentions, onClick, loading }: UnitMentionsChipProps) {
  if (loading || totalMentions === 0) {
    return null;
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10">
              <Users className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Unit mentions found</span>
                <Badge variant="secondary" className="font-mono">
                  {totalMentions}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Apartment/unit identifiers extracted from record text
              </p>
            </div>
          </div>
          {onClick && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClick}
              className="text-primary hover:text-primary/80 gap-1"
            >
              View
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
