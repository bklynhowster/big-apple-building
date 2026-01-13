import { MapPin, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PropertyMapProps {
  lat?: number;
  lon?: number;
  address?: string;
}

export function PropertyMap({ lat, lon, address }: PropertyMapProps) {
  if (!lat || !lon) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Location
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Location coordinates not available for this property.
          </p>
        </CardContent>
      </Card>
    );
  }

  // OpenStreetMap embed URL centered on the property
  const zoom = 17;
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.002},${lat - 0.001},${lon + 0.002},${lat + 0.001}&layer=mapnik&marker=${lat},${lon}`;
  
  // Links to open in full map applications
  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Location
          </CardTitle>
          <div className="flex items-center gap-3 text-xs">
            <a
              href={osmUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline flex items-center gap-1"
            >
              OpenStreetMap
              <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline flex items-center gap-1"
            >
              Google Maps
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="rounded-md overflow-hidden border border-border">
          <iframe
            title={`Map showing ${address || 'property location'}`}
            src={osmEmbedUrl}
            width="100%"
            height="200"
            style={{ border: 0 }}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="block"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {lat.toFixed(6)}, {lon.toFixed(6)}
        </p>
      </CardContent>
    </Card>
  );
}
