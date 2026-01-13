import { Building2, ExternalLink, Camera, MapPinOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface BuildingPhotoCardProps {
  lat?: number | null;
  lon?: number | null;
}

// Centralized helper - NO URL encoding, keep hash and slashes intact
function makeNYCHistoricMapLink(
  era: "1940s" | "80s",
  lat?: number | null,
  lon?: number | null,
  zoom: number = 19
): string {
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) {
    return `https://${era}.nyc/map`;
  }
  const latStr = lat.toFixed(6);
  const lonStr = lon.toFixed(6);
  return `https://${era}.nyc/map#${zoom}/${latStr}/${lonStr}`;
}

export function BuildingPhotoCard({ lat, lon }: BuildingPhotoCardProps) {
  const hasCoords = lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon);
  const url1940s = makeNYCHistoricMapLink("1940s", lat, lon);
  const url80s = makeNYCHistoricMapLink("80s", lat, lon);

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
      <CardContent className="flex flex-col gap-3">
        {hasCoords ? (
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={url1940s}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-100/50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200/70 hover:text-amber-950 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-800/50"
              onClick={(e) => e.stopPropagation()}
            >
              <Building2 className="h-4 w-4" />
              1940s tax photo
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
            <a
              href={url80s}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              1980s tax photo
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPinOff className="h-4 w-4" />
            <span>Search must resolve to a precise location to open tax photos.</span>
          </div>
        )}
        {/* DEV: show the exact URL so we can confirm it matches what works when pasted */}
        {import.meta.env.DEV && hasCoords && (
          <div className="text-xs opacity-70 break-all mt-1 font-mono">
            <div>1940s: {url1940s}</div>
            <div>80s: {url80s}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
