import { ExternalLink, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { toast } from 'sonner';

interface HistoricPhotographSectionProps {
  block: string | null;
  lot: string | null;
  borough: string | null;
  landUse?: string | null;
  bbl?: string | null;
}

// Parse borough code, block, and lot from a 10-digit BBL string
function parseBBL(bbl: string): { boroughCode: string; block: string; lot: string } | null {
  if (!bbl || bbl.length !== 10) return null;
  const boroughCode = bbl.charAt(0);
  const block = bbl.slice(1, 6); // Already 5 digits with leading zeros
  const lot = bbl.slice(6, 10); // Already 4 digits with leading zeros
  return { boroughCode, block, lot };
}

// Build the 1940s Municipal Archives identifier
function buildArchivesIdentifier(boroughCode: string, block: string, lot: string): string {
  // Ensure block is 5 digits padded, lot is 4 digits padded
  const blockPadded = block.replace(/^0+/, '').padStart(5, '0');
  const lotPadded = lot.replace(/^0+/, '').padStart(4, '0');
  return `nyyma_rec0040_${boroughCode}_${blockPadded}_${lotPadded}`;
}

function buildArchiveSearchUrl(identifier: string): string {
  return `https://nycrecords.access.preservica.com/?q=${encodeURIComponent(identifier)}`;
}

export function HistoricPhotographSection({ block, lot, bbl }: HistoricPhotographSectionProps) {
  const [copied, setCopied] = useState(false);
  
  // Try to parse from BBL first (most reliable for getting borough code)
  let boroughCode: string | null = null;
  let effectiveBlock: string | null = block;
  let effectiveLot: string | null = lot;
  
  if (bbl) {
    const parsed = parseBBL(bbl);
    if (parsed) {
      boroughCode = parsed.boroughCode;
      effectiveBlock = effectiveBlock || parsed.block;
      effectiveLot = effectiveLot || parsed.lot;
    }
  }
  
  // If we don't have all required data, don't render
  if (!boroughCode || !effectiveBlock || !effectiveLot) {
    return null;
  }

  const identifier = buildArchivesIdentifier(boroughCode, effectiveBlock, effectiveLot);
  const searchUrl = buildArchiveSearchUrl(identifier);

  const handleCopyIdentifier = async () => {
    try {
      await navigator.clipboard.writeText(identifier);
      setCopied(true);
      toast.success('Identifier copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy identifier');
    }
  };

  return (
    <div className="border-t border-border pt-4 mt-4">
      <div className="text-sm font-medium text-foreground mb-1">
        Historic Municipal Photograph (c. 1940)
      </div>
      
      <p className="text-xs text-muted-foreground mb-3">
        NYC Department of Records & Information Services — Municipal Tax Photograph archive.
      </p>
      
      {/* Search button */}
      <div className="mb-3">
        <Button
          variant="outline"
          size="sm"
          asChild
          className="h-8 text-xs"
        >
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3 mr-1.5" />
            Search Municipal Archives (1940s)
          </a>
        </Button>
      </div>
      
      {/* Identifier display with copy */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">Identifier:</span>
        <code className="text-[10px] font-mono text-foreground bg-muted px-1.5 py-0.5 rounded">
          {identifier}
        </code>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyIdentifier}
          className="h-5 w-5 p-0"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-600" />
          ) : (
            <Copy className="h-3 w-3 text-muted-foreground" />
          )}
        </Button>
      </div>
      
      {/* Tip */}
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed mt-2">
        Tip: Condos/co-ops sometimes require building-level search. 1980s photos may also be available.
      </p>
    </div>
  );
}
