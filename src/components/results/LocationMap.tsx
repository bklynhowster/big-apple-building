import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';


mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';

interface LocationMapProps {
  lat?: number;
  lon?: number;
  address?: string;
}

export function LocationMap({ lat, lon, address }: LocationMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!lat || !lon || !mapRef.current) return;

    // Clean up existing map instance
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [lon, lat],
      zoom: 16,
      scrollZoom: false,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');

    // Add marker
    const marker = new mapboxgl.Marker({ color: '#c45d3e' })
      .setLngLat([lon, lat]);

    if (address) {
      marker.setPopup(
        new mapboxgl.Popup({ offset: 25, closeButton: false }).setText(address)
      );
    }

    marker.addTo(map);
    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [lat, lon, address]);

  if (!lat || !lon) return null;

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-border">
      {/* Map container */}
      <div
        ref={mapRef}
        className="w-full h-[180px] md:h-[200px]"
        role="img"
        aria-label={`Map showing location of ${address || 'property'}`}
      />
    </div>
  );
}
