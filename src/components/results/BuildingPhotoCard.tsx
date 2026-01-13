import { Building2, ExternalLink, Camera, MapPinOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface BuildingPhotoCardProps {
  lat?: number;
  lon?: number;
}

// Centralized helper to build tax photo URLs
function buildTaxPhotoLinks(lat: number | undefined, lon: number | undefined) {
  const zoom = 19;
  const hasCoords = lat !== undefined && lon !== undefined;
  
  return {
    hasCoords,
    url1940s: hasCoords ? `https://1940s.nyc/map#${zoom}/${lat}/${lon}` : null,
    url80s: hasCoords ? `https://80s.nyc/#${zoom}/${lat}/${lon}` : null,
  };
}

export function BuildingPhotoCard({ lat, lon }: BuildingPhotoCardProps) {
  const { hasCoords, url1940s, url80s } = buildTaxPhotoLinks(lat, lon);

  return (
    <Card className="border-amber-200/50 bg-gradient-to-br from-amber-50/50 to-background dark:from-amber-950/20 dark:to-background">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Camera className="h-5 w-5 text-amber-700 dark:text-amber-500" />
          <span>Historic Building Photos</span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          NYC Municipal Archives tax photos — view this property in earlier decades
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        {hasCoords ? (
          <>
            <Button
              variant="outline"
              className="gap-2 border-amber-300 bg-amber-100/50 text-amber-900 hover:bg-amber-200/70 hover:text-amber-950 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-800/50"
              onClick={() => window.open(url1940s!, '_blank', 'noopener,noreferrer')}
            >
              <Building2 className="h-4 w-4" />
              1940s tax photo
              <ExternalLink className="h-3 w-3 opacity-60" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => window.open(url80s!, '_blank', 'noopener,noreferrer')}
            >
              1980s tax photo
              <ExternalLink className="h-3 w-3 opacity-60" />
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPinOff className="h-4 w-4" />
            <span>Search must resolve to a precise location to open tax photos.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
