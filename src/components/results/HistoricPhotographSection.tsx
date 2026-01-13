import { ExternalLink, Search, ImageOff } from 'lucide-react';
import { useArchivesPhoto, getBlockLotFromBBL } from '@/hooks/useArchivesPhoto';
import { Skeleton } from '@/components/ui/skeleton';

interface HistoricPhotographSectionProps {
  block: string | null;
  lot: string | null;
  borough: string | null;
  landUse?: string | null;
  bbl?: string | null;
}

function isCondoLot(lot: string | null, landUse?: string | null): boolean {
  if (!lot) return false;
  const lotNum = parseInt(lot, 10);
  if (lotNum >= 7500) return true;
  if (landUse && landUse.toLowerCase().includes('condo')) return true;
  return false;
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
  
  // Fetch actual archive data
  const { data, isLoading, error } = useArchivesPhoto(effectiveBlock, effectiveLot);
  
  // If we don't have block/lot, don't render
  if (!effectiveBlock || !effectiveLot) {
    return null;
  }

  const isCondo = isCondoLot(effectiveLot, landUse);
  
  // Build fallback search URL
  const fallbackSearchUrl = `https://nycrecords.access.preservica.com/?q=${encodeURIComponent(`block=${effectiveBlock} AND lot=${effectiveLot}`)}`;
  
  // Use resolved URLs or fallback to search
  const viewUrl = data?.itemUrl || data?.searchUrl || fallbackSearchUrl;
  const thumbnailUrl = data?.thumbnailUrl;

  return (
    <div className="border-t pt-4 mt-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground mb-1">
          Historic Municipal Photograph (c. 1940)
        </div>
        
        <p className="text-xs text-muted-foreground mb-3">
          NYC Department of Records & Information Services — Municipal Tax Photograph archive.
          {isCondo && ' Condos may require searching the building lot.'}
          {' '}Availability varies by property.
        </p>
        
        {/* Thumbnail area */}
        <div className="mb-3">
          {isLoading ? (
            <Skeleton className="w-full max-w-[280px] h-[180px] rounded-md" />
          ) : thumbnailUrl ? (
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-fit"
            >
              <img
                src={thumbnailUrl}
                alt={`Historic tax photograph of Block ${effectiveBlock}, Lot ${effectiveLot}`}
                className="max-h-[180px] w-auto max-w-full rounded-md border border-border object-cover grayscale hover:grayscale-0 transition-all duration-300 cursor-pointer hover:shadow-md"
                onError={(e) => {
                  // Hide image on error
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </a>
          ) : !isLoading && !error ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/70 py-2">
              <ImageOff className="h-4 w-4" />
              <span>No photograph found in archives</span>
            </div>
          ) : null}
        </div>
        
        {/* Links */}
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            {data?.itemUrl ? (
              <ExternalLink className="h-3 w-3" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            View in NYC Municipal Archives
          </a>
          
          {data?.itemUrl && (
            <>
              <span className="text-muted-foreground text-xs">•</span>
              <a
                href={data.itemUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Order archival print
              </a>
            </>
          )}
        </div>
        
        {/* Query disclosure */}
        <div className="text-[10px] text-muted-foreground/70 font-mono">
          Query: block={effectiveBlock} AND lot={effectiveLot}
        </div>
      </div>
    </div>
  );
}
