import { ExternalLink, Search, Loader2 } from 'lucide-react';
import { useArchivesPhoto, getBlockLotFromBBL } from '@/hooks/useArchivesPhoto';
import { Button } from '@/components/ui/button';

interface HistoricPhotographSectionProps {
  block: string | null;
  lot: string | null;
  borough: string | null;
  landUse?: string | null;
  bbl?: string | null;
}

function buildArchiveSearchUrl(block: string, lot: string): string {
  const query = `block=${block} AND lot=${lot}`;
  return `https://nycrecords.access.preservica.com/?q=${encodeURIComponent(query)}`;
}

export function HistoricPhotographSection({ block, lot, borough, landUse, bbl }: HistoricPhotographSectionProps) {
  // Try to get block/lot from props, fallback to parsing BBL
  let effectiveBlock = block;
  let effectiveLot = lot;
  
  if ((!effectiveBlock || !effectiveLot) && bbl) {
    const parsed = getBlockLotFromBBL(bbl);
    if (parsed) {
      effectiveBlock = effectiveBlock || parsed.block;
      effectiveLot = effectiveLot || parsed.lot;
    }
  }
  
  // Fetch archive data from edge function
  const { data, isLoading, error } = useArchivesPhoto(effectiveBlock, effectiveLot);
  
  // If we don't have block/lot, don't render
  if (!effectiveBlock || !effectiveLot) {
    return null;
  }

  const query = `block=${effectiveBlock} AND lot=${effectiveLot}`;
  const searchUrl = data?.searchUrl || buildArchiveSearchUrl(effectiveBlock, effectiveLot);
  const itemUrl = data?.itemUrl;
  const hasDirectMatch = !!itemUrl;

  return (
    <div className="border-t pt-4 mt-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground mb-1">
          Historic Municipal Photograph (c. 1940)
        </div>
        
        <p className="text-xs text-muted-foreground mb-3">
          NYC Department of Records & Information Services — Municipal Tax Photograph archive.
          Availability varies by property.
        </p>
        
        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 mb-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Searching Municipal Archives…</span>
          </div>
        )}
        
        {/* Results state */}
        {!isLoading && (
          <div className="space-y-3">
            {hasDirectMatch ? (
              /* State 1: Found a specific item URL */
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  asChild
                  className="h-8"
                >
                  <a
                    href={itemUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    View photo
                  </a>
                </Button>
                
                <Button
                  variant="ghost"
                  size="sm"
                  asChild
                  className="h-8 text-muted-foreground"
                >
                  <a
                    href={searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Search className="h-3.5 w-3.5 mr-1.5" />
                    Search archives
                  </a>
                </Button>
              </div>
            ) : (
              /* State 2: Not found / resolver failed */
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground/80">
                  No direct match found (yet).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="h-8"
                >
                  <a
                    href={searchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Search className="h-3.5 w-3.5 mr-1.5" />
                    Search archives for block/lot
                  </a>
                </Button>
              </div>
            )}
            
            {/* Query disclosure */}
            <div className="text-[10px] text-muted-foreground/70 font-mono">
              {hasDirectMatch ? 'Matched query' : 'Query'}: {query}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
