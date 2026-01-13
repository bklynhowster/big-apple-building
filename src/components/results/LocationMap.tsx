import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Fix default marker icon issue with bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface LocationMapProps {
  lat?: number;
  lon?: number;
  address?: string;
}

export function LocationMap({ lat, lon, address }: LocationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!lat || !lon || !mapRef.current) return;

    // Clean up existing map instance
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    // Create map centered on property
    const map = L.map(mapRef.current, {
      center: [lat, lon],
      zoom: 15,
      scrollWheelZoom: false,
      zoomControl: true,
    });

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    // Add marker at property location
    const marker = L.marker([lat, lon]);
    if (address) {
      marker.bindPopup(`<strong>${address}</strong>`);
    }
    marker.addTo(map);

    mapInstanceRef.current = map;

    // Cleanup on unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [lat, lon, address]);

  // Don't render if no coordinates
  if (!lat || !lon) {
    return null;
  }

  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-border">
      {/* External links - positioned top-right */}
      <div className="absolute top-2 right-2 z-[1000] flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-6 px-2 text-xs bg-background/90 backdrop-blur-sm hover:bg-background border border-border/50"
        >
          <a href={osmUrl} target="_blank" rel="noopener noreferrer">
            OpenStreetMap
            <ExternalLink className="h-3 w-3 ml-1" />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="h-6 px-2 text-xs bg-background/90 backdrop-blur-sm hover:bg-background border border-border/50"
        >
          <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
            Google Maps
            <ExternalLink className="h-3 w-3 ml-1" />
          </a>
        </Button>
      </div>

      {/* Coordinates overlay - bottom-left */}
      <div className="absolute bottom-2 left-2 z-[1000]">
        <span className="px-2 py-1 text-[10px] font-mono text-muted-foreground bg-background/90 backdrop-blur-sm rounded border border-border/50">
          {lat.toFixed(6)}, {lon.toFixed(6)}
        </span>
      </div>

      {/* Map container - responsive height */}
      <div
        ref={mapRef}
        className="w-full h-[160px] md:h-[180px]"
        role="img"
        aria-label={`Map showing location of ${address || 'property'}`}
      />
    </div>
  );
}
