import { Building2, ExternalLink, Camera } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface BuildingPhotoCardProps {
  lat?: number;
  lon?: number;
}

export function BuildingPhotoCard({ lat, lon }: BuildingPhotoCardProps) {
  // Build the 1940s.nyc URL with coordinates if available
  const get1940sUrl = () => {
    const baseUrl = 'https://1940s.nyc/map';
    if (lat !== undefined && lon !== undefined) {
      // 1940s.nyc uses #lat,lon,zoom format
      return `${baseUrl}/#${lat},${lon},18`;
    }
    return baseUrl;
  };

  const get1980sUrl = () => {
    return 'https://80s.nyc/';
  };

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
        <Button
          variant="outline"
          className="gap-2 border-amber-300 bg-amber-100/50 text-amber-900 hover:bg-amber-200/70 hover:text-amber-950 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-800/50"
          onClick={() => window.open(get1940sUrl(), '_blank', 'noopener,noreferrer')}
        >
          <Building2 className="h-4 w-4" />
          Open 1940s tax photo
          <ExternalLink className="h-3 w-3 opacity-60" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground hover:text-foreground"
          onClick={() => window.open(get1980sUrl(), '_blank', 'noopener,noreferrer')}
        >
          Try 1980s tax photo
          <ExternalLink className="h-3 w-3 opacity-60" />
        </Button>
      </CardContent>
    </Card>
  );
}
