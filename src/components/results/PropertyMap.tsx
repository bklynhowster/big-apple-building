import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Card, CardContent } from '@/components/ui/card';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';

interface PropertyMapProps {
  latitude: number;
  longitude: number;
  address?: string;
}

export function PropertyMap({ latitude, longitude, address }: PropertyMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [longitude, latitude],
      zoom: 16,
      attributionControl: false,
      // Disable touch interactions that trap mobile scrolling
      scrollZoom: false,
      boxZoom: false,
      dragRotate: false,
      touchZoomRotate: false,
      touchPitch: false,
      // Keep drag pan but only via mouse/two-finger on mobile
      cooperativeGestures: true,
    });

    // Add minimal attribution (required by Mapbox TOS)
    map.current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    // Add zoom controls
    map.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    // Add marker
    const marker = new mapboxgl.Marker({ color: '#c45d3e' })
      .setLngLat([longitude, latitude]);

    if (address) {
      marker.setPopup(new mapboxgl.Popup({ offset: 25, closeButton: false }).setText(address));
    }

    marker.addTo(map.current);

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [latitude, longitude, address]);

  return (
    <Card>
      <CardContent className="p-0 overflow-hidden rounded-lg">
        <div ref={mapContainer} style={{ width: '100%', height: '220px' }} />
      </CardContent>
    </Card>
  );
}
