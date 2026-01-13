import { ExternalLink, Search } from 'lucide-react';

interface HistoricPhotographSectionProps {
  block: string | null;
  lot: string | null;
  borough: string | null;
  landUse?: string | null;
  bbl?: string | null;
}

function parseBBL(bbl: string): { block: string; lot: string } | null {
  // BBL is 10 digits: 1 borough + 5 block + 4 lot
  const cleaned = bbl.replace(/\D/g, '');
  if (cleaned.length !== 10) return null;
  
  const block = parseInt(cleaned.substring(1, 6), 10).toString();
  const lot = parseInt(cleaned.substring(6, 10), 10).toString();
  
  return { block, lot };
}

function isCondoLot(lot: string | null, landUse?: string | null): boolean {
  if (!lot) return false;
  const lotNum = parseInt(lot, 10);
  // Condo if lot >= 7500 or landUse indicates condo
  if (lotNum >= 7500) return true;
  if (landUse && landUse.toLowerCase().includes('condo')) return true;
  return false;
}

function getCondoLotCandidates(primaryLot: string): string[] {
  const candidates: string[] = [primaryLot];
  const lotNum = parseInt(primaryLot, 10);
  
  // Add 7501 (common elements) if not already the primary
  if (lotNum !== 7501) {
    candidates.push('7501');
  }
  
  // Add 1 (frequent base-lot fallback) if not already included
  if (lotNum !== 1 && !candidates.includes('1')) {
    candidates.push('1');
  }
  
  return candidates;
}

function buildArchiveSearchUrl(block: string, lot: string): string {
  const searchQuery = `block=${block} AND lot=${lot}`;
  const encodedQuery = encodeURIComponent(searchQuery);
  return `https://nycma.lunaimaging.com/luna/servlet/view/search?q=${encodedQuery}`;
}

export function HistoricPhotographSection({ block, lot, borough, landUse, bbl }: HistoricPhotographSectionProps) {
  // Try to get block/lot from props, fallback to parsing BBL
  let effectiveBlock = block;
  let effectiveLot = lot;
  
  if ((!effectiveBlock || !effectiveLot) && bbl) {
    const parsed = parseBBL(bbl);
    if (parsed) {
      effectiveBlock = effectiveBlock || parsed.block;
      effectiveLot = effectiveLot || parsed.lot;
    }
  }
  
  // If we still don't have block/lot, don't render
  if (!effectiveBlock || !effectiveLot) {
    return null;
  }

  const isCondo = isCondoLot(effectiveLot, landUse);
  const lotCandidates = isCondo ? getCondoLotCandidates(effectiveLot) : [effectiveLot];
  
  const primaryUrl = buildArchiveSearchUrl(effectiveBlock, lotCandidates[0]);
  const fallbackUrl = lotCandidates.length > 1 
    ? buildArchiveSearchUrl(effectiveBlock, lotCandidates[1]) 
    : null;

  return (
    <div className="border-t pt-4 mt-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground mb-1">
          Historic Municipal Photograph (c. 1940)
        </div>
        
        <p className="text-xs text-muted-foreground mb-3">
          NYC Department of Records & Information Services — Municipal Tax Photograph archive.
          {isCondo && ' Condos may require searching the building lot.'}
        </p>
        
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <a
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <Search className="h-3 w-3" />
            Search Municipal Archives
          </a>
          
          {fallbackUrl && (
            <>
              <span className="text-muted-foreground text-xs">•</span>
              <a
                href={fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Search className="h-3 w-3" />
                Try building lot (recommended)
              </a>
            </>
          )}
          
          <span className="text-muted-foreground text-xs">•</span>
          
          <a
            href="https://www.nyc.gov/site/records/historical-records/order.page"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Order archival print
          </a>
        </div>
        
        <div className="text-[10px] text-muted-foreground/70 font-mono">
          Query: block={effectiveBlock} AND lot={lotCandidates[0]}
        </div>
      </div>
    </div>
  );
}