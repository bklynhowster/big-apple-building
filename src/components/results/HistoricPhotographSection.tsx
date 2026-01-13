import { ExternalLink, Image as ImageIcon } from 'lucide-react';

interface HistoricPhotographSectionProps {
  block: string | null;
  lot: string | null;
  borough: string | null;
}

// Map borough names to DORIS codes
const BOROUGH_CODES: Record<string, string> = {
  'Manhattan': 'Manhattan',
  'Bronx': 'Bronx',
  'Brooklyn': 'Brooklyn',
  'Queens': 'Queens',
  'Staten Island': 'Staten Island',
};

function buildArchiveSearchUrl(borough: string | null, block: string | null, lot: string | null): string | null {
  if (!block || !lot) return null;
  
  // Construct search query for NYC Municipal Archives
  // Format: block={BLOCK} AND lot={LOT}
  const searchQuery = `block=${block} AND lot=${lot}`;
  const encodedQuery = encodeURIComponent(searchQuery);
  
  return `https://nycma.lunaimaging.com/luna/servlet/view/search?q=${encodedQuery}`;
}

export function HistoricPhotographSection({ block, lot, borough }: HistoricPhotographSectionProps) {
  const archiveUrl = buildArchiveSearchUrl(borough, block, lot);
  
  // If we can't construct a valid search URL, don't render
  if (!archiveUrl || !block || !lot) {
    return null;
  }

  return (
    <div className="border-t pt-4 mt-4">
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-md bg-muted shrink-0">
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground mb-1">
            Historic Municipal Photograph (c. 1940)
          </div>
          
          <p className="text-xs text-muted-foreground mb-3">
            NYC Department of Records & Information Services — Municipal Tax Photograph archive. 
            Availability varies by property.
          </p>
          
          <div className="flex flex-wrap gap-2">
            <a
              href={archiveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              View in NYC Municipal Archives
            </a>
            
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
        </div>
      </div>
    </div>
  );
}
