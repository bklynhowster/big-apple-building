import { Copy, ExternalLink, Check, MapPin, Building2, Share2, Bookmark, BookmarkCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { useSavedSearches } from '@/hooks/useSavedSearches';

interface PropertyOverviewProps {
  bbl: string;
  address?: string;
  borough?: string;
  bin?: string;
  latitude?: number;
  longitude?: number;
}

// Extract block and lot from BBL
function parseBBL(bbl: string): { boroughCode: string; block: string; lot: string } {
  const padded = bbl.padStart(10, '0');
  return {
    boroughCode: padded.charAt(0),
    block: padded.slice(1, 6),
    lot: padded.slice(6, 10),
  };
}

const BOROUGH_NAMES: Record<string, string> = {
  '1': 'Manhattan',
  '2': 'Bronx',
  '3': 'Brooklyn',
  '4': 'Queens',
  '5': 'Staten Island',
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({
        title: 'Copied!',
        description: `${label} copied to clipboard`,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Please try again',
        variant: 'destructive',
      });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs gap-1"
      onClick={handleCopy}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      Copy
    </Button>
  );
}

export function PropertyOverview({
  bbl,
  address,
  borough,
  bin,
  latitude,
  longitude,
}: PropertyOverviewProps) {
  const { boroughCode, block, lot } = parseBBL(bbl);
  const derivedBorough = borough || BOROUGH_NAMES[boroughCode] || '';
  const { saveSearch, isSearchSaved, deleteSearch, getSearchByBBL } = useSavedSearches();

  const isSaved = isSearchSaved(bbl);

  // External links
  const bisUrl = bin
    ? `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${bin}`
    : `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?boro=${boroughCode}&block=${block}&lot=${lot}`;
  
  const dobNowUrl = 'https://a810-dobnow.nyc.gov/publish/Index.html';
  
  const acrisUrl = `https://a836-acris.nyc.gov/bblsearch/bblsearch.asp?borough=${boroughCode}&block=${block}&lot=${lot}`;

  const handleSaveSearch = () => {
    if (isSaved) {
      const existing = getSearchByBBL(bbl);
      if (existing) {
        deleteSearch(existing.id);
        toast({
          title: 'Search removed',
          description: 'Property removed from saved searches',
        });
      }
    } else {
      saveSearch({
        bbl,
        address: address || undefined,
        borough: derivedBorough || undefined,
        bin: bin || undefined,
      });
      toast({
        title: 'Search saved',
        description: 'Property added to saved searches',
      });
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Link copied',
        description: 'Results URL copied to clipboard',
      });
    } catch {
      toast({
        title: 'Failed to copy',
        description: 'Please copy the URL manually',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="border-border">
      <CardContent className="p-5">
        <div className="space-y-4">
          {/* Address and identifiers */}
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div className="space-y-2">
              {address && (
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <h1 className="text-xl font-semibold text-foreground">{address}</h1>
                  <CopyButton value={address} label="Address" />
                </div>
              )}
              
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                {derivedBorough && (
                  <span className="text-muted-foreground">{derivedBorough}</span>
                )}
                <div className="flex items-center gap-1">
                  <span className="font-mono text-muted-foreground">BBL:</span>
                  <span className="font-mono font-medium">{bbl}</span>
                  <CopyButton value={bbl} label="BBL" />
                </div>
                {bin && (
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-muted-foreground">BIN:</span>
                    <span className="font-mono font-medium">{bin}</span>
                    <CopyButton value={bin} label="BIN" />
                  </div>
                )}
              </div>
              
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>Block: {block}</span>
                <span>Lot: {lot}</span>
                {latitude && longitude && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {latitude.toFixed(6)}, {longitude.toFixed(6)}
                  </span>
                )}
              </div>
            </div>

            {/* Actions and External Links */}
            <div className="flex flex-col gap-2">
              {/* Save and Share */}
              <div className="flex gap-2">
                <Button
                  variant={isSaved ? "secondary" : "outline"}
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={handleSaveSearch}
                >
                  {isSaved ? (
                    <>
                      <BookmarkCheck className="h-3 w-3" />
                      Saved
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-3 w-3" />
                      Save
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={handleShare}
                >
                  <Share2 className="h-3 w-3" />
                  Share
                </Button>
              </div>
              
              {/* External Links */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  asChild
                >
                  <a href={bisUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3" />
                    DOB BIS
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  asChild
                >
                  <a href={dobNowUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3" />
                    DOB NOW
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  asChild
                >
                  <a href={acrisUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3" />
                    ACRIS
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
