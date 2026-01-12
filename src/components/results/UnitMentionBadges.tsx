import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Info } from 'lucide-react';
import type { UnitMention } from '@/hooks/useRecordUnitMentions';

interface UnitMentionBadgesProps {
  mentions: UnitMention[];
  maxVisible?: number;
  matchesContext?: boolean;
  compact?: boolean;
}

/**
 * Display unit mention badges with popover for details.
 * Shows up to maxVisible badges, with "+N more" for additional.
 */
export function UnitMentionBadges({ 
  mentions, 
  maxVisible = 3,
  matchesContext = false,
  compact = false 
}: UnitMentionBadgesProps) {
  if (mentions.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  
  const visibleMentions = mentions.slice(0, maxVisible);
  const hiddenCount = mentions.length - maxVisible;
  
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {visibleMentions.map((mention, idx) => (
        <Popover key={`${mention.unit}-${idx}`}>
          <PopoverTrigger asChild>
            <Badge 
              variant={matchesContext && mention.unit === mentions[0]?.unit ? "default" : "outline"}
              className={`
                font-mono text-xs cursor-help px-1.5 py-0
                ${matchesContext ? 'border-primary bg-primary/10' : ''}
                ${compact ? 'text-[10px]' : ''}
              `}
            >
              {mention.unit}
            </Badge>
          </PopoverTrigger>
          <PopoverContent className="w-80 text-sm" side="top">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">{mention.unit}</span>
                <Badge 
                  variant={mention.confidence === 'high' ? 'default' : mention.confidence === 'medium' ? 'secondary' : 'outline'}
                  className="text-[10px] px-1"
                >
                  {mention.confidence}
                </Badge>
              </div>
              
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Found in:</span> {mention.sourceField}
              </div>
              
              {mention.snippet && (
                <div className="text-xs bg-muted/50 p-2 rounded border">
                  <span className="text-muted-foreground italic">"</span>
                  <span 
                    dangerouslySetInnerHTML={{
                      __html: mention.snippet.replace(
                        new RegExp(`(${mention.unit})`, 'gi'),
                        '<mark class="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">$1</mark>'
                      )
                    }}
                  />
                  <span className="text-muted-foreground italic">"</span>
                </div>
              )}
              
              <div className="text-[10px] text-muted-foreground flex items-start gap-1 pt-1 border-t">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Unit mention extracted from building-level record text. 
                  Does not imply unit-specific enforcement.
                </span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      ))}
      
      {hiddenCount > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Badge variant="secondary" className="text-[10px] cursor-help px-1">
              +{hiddenCount}
            </Badge>
          </PopoverTrigger>
          <PopoverContent className="w-60 text-sm" side="top">
            <div className="space-y-1">
              <p className="text-xs font-medium mb-2">All mentioned units:</p>
              <div className="flex flex-wrap gap-1">
                {mentions.map((m, i) => (
                  <Badge key={i} variant="outline" className="font-mono text-xs">
                    {m.unit}
                  </Badge>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
      
      {matchesContext && (
        <Badge variant="default" className="text-[10px] px-1 bg-primary/80">
          Context
        </Badge>
      )}
    </div>
  );
}
