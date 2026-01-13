import { ExternalLink, Search } from 'lucide-react';
import { getBlockLotFromBBL } from '@/hooks/useArchivesPhoto';
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
  
  // If we don't have block/lot, don't render
  if (!effectiveBlock || !effectiveLot) {
    return null;
  }

  const query = `block=${effectiveBlock} AND lot=${effectiveLot}`;
  const searchUrl = buildArchiveSearchUrl(effectiveBlock, effectiveLot);

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
        
        <div className="space-y-3">
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
              Search Municipal Archives
            </a>
          </Button>
          
          {/* Query disclosure */}
          <div className="text-[10px] text-muted-foreground/70 font-mono">
            Query: {query}
          </div>
        </div>
      </div>
    </div>
  );
}
