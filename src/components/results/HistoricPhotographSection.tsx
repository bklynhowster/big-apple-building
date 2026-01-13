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

// Parse block and lot from a 10-digit BBL string
function getBlockLotFromBBL(bbl: string): { block: string; lot: string } | null {
  if (!bbl || bbl.length !== 10) return null;
  const block = bbl.slice(1, 6).replace(/^0+/, '') || '0';
  const lot = bbl.slice(6, 10).replace(/^0+/, '') || '0';
  return { block, lot };
}

function buildArchiveSearchUrl(block: string, lot: string): string {
  const query = `block=${block} AND lot=${lot}`;
  return `https://nycrecords.access.preservica.com/?q=${encodeURIComponent(query)}`;
}

export function HistoricPhotographSection({ block, lot, bbl }: HistoricPhotographSectionProps) {
  const [copied, setCopied] = useState(false);
  
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

  const handleCopyQuery = async () => {
    try {
      await navigator.clipboard.writeText(query);
      setCopied(true);
      toast.success('Query copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy query');
    }
  };

  return (
    <div className="border-t border-border pt-4 mt-4">
      <div className="text-sm font-medium text-foreground mb-1">
        Historic Municipal Photograph (c. 1940)
      </div>
      
      <p className="text-xs text-muted-foreground mb-3">
        NYC Department of Records & Information Services — Municipal Tax Photograph archive.
        Use Block/Lot to search.
      </p>
      
      {/* Block/Lot display */}
      <div className="flex items-center gap-4 mb-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Block:</span>
          <span className="font-mono font-medium text-foreground">{effectiveBlock}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Lot:</span>
          <span className="font-mono font-medium text-foreground">{effectiveLot}</span>
        </div>
      </div>
      
      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyQuery}
          className="h-7 text-xs"
        >
          {copied ? (
            <Check className="h-3 w-3 mr-1.5" />
          ) : (
            <Copy className="h-3 w-3 mr-1.5" />
          )}
          Copy Query
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-7 text-xs"
        >
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3 mr-1.5" />
            Search 1940s photos
          </a>
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-7 text-xs"
        >
          <a
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3 mr-1.5" />
            Search 1980s photos
          </a>
        </Button>
      </div>
      
      {/* Tip */}
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
        Tip: Results may appear under 1940s or 1980s Tax Department photographs. 
        Condos/co-ops sometimes require building-level search.
      </p>
    </div>
  );
}
