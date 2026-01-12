import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, Grid3X3, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import type { Borough } from '@/types/property';

const BOROUGHS: { value: Borough; label: string }[] = [
  { value: 'MANHATTAN', label: 'Manhattan' },
  { value: 'BRONX', label: 'Bronx' },
  { value: 'BROOKLYN', label: 'Brooklyn' },
  { value: 'QUEENS', label: 'Queens' },
  { value: 'STATEN ISLAND', label: 'Staten Island' },
];

const STREET_TYPES = [
  { value: 'None', label: '(None / Already included)' },
  { value: 'St', label: 'Street (St)' },
  { value: 'Ave', label: 'Avenue (Ave)' },
  { value: 'Rd', label: 'Road (Rd)' },
  { value: 'Blvd', label: 'Boulevard (Blvd)' },
  { value: 'Pl', label: 'Place (Pl)' },
  { value: 'Dr', label: 'Drive (Dr)' },
  { value: 'Ct', label: 'Court (Ct)' },
  { value: 'Ln', label: 'Lane (Ln)' },
  { value: 'Ter', label: 'Terrace (Ter)' },
  { value: 'Pkwy', label: 'Parkway (Pkwy)' },
  { value: 'Way', label: 'Way' },
  { value: 'Hwy', label: 'Highway (Hwy)' },
];

// Mapping of full suffix words to abbreviations (case-insensitive)
const SUFFIX_MAP: Record<string, string> = {
  'street': 'St',
  'st': 'St',
  'avenue': 'Ave',
  'ave': 'Ave',
  'road': 'Rd',
  'rd': 'Rd',
  'boulevard': 'Blvd',
  'blvd': 'Blvd',
  'place': 'Pl',
  'pl': 'Pl',
  'drive': 'Dr',
  'dr': 'Dr',
  'court': 'Ct',
  'ct': 'Ct',
  'lane': 'Ln',
  'ln': 'Ln',
  'terrace': 'Ter',
  'ter': 'Ter',
  'parkway': 'Pkwy',
  'pkwy': 'Pkwy',
  'way': 'Way',
  'highway': 'Hwy',
  'hwy': 'Hwy',
};

// Extract suffix from street name if present
function extractSuffix(streetName: string): { name: string; type: string } {
  const trimmed = streetName.trim();
  const words = trimmed.split(/\s+/);
  
  if (words.length < 2) {
    return { name: trimmed, type: '' };
  }
  
  const lastWord = words[words.length - 1].toLowerCase();
  const abbreviation = SUFFIX_MAP[lastWord];
  
  if (abbreviation) {
    // Remove the last word and return the abbreviation
    const nameWithoutSuffix = words.slice(0, -1).join(' ');
    return { name: nameWithoutSuffix, type: abbreviation };
  }
  
  return { name: trimmed, type: '' };
}

export function SearchForm() {
  const navigate = useNavigate();
  const [searchType, setSearchType] = useState<'address' | 'bbl'>('address');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Address search state
  const [houseNumber, setHouseNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [streetType, setStreetType] = useState('');
  const [borough, setBorough] = useState<Borough | ''>('');
  
  // BBL search state
  const [bblBorough, setBblBorough] = useState('');
  const [block, setBlock] = useState('');
  const [lot, setLot] = useState('');

  const handleAddressSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!houseNumber || !streetName || !borough) return;
    
    setLoading(true);
    setError(null);
    
    // Auto-detect suffix if streetType not explicitly set
    let finalStreetName = streetName.trim();
    let finalStreetType = streetType || 'None';
    
    // If no street type selected, try to extract from street name
    if (!streetType) {
      const extracted = extractSuffix(streetName);
      if (extracted.type) {
        finalStreetName = extracted.name;
        finalStreetType = extracted.type;
      }
    }
    
    try {
      const params = new URLSearchParams({
        type: 'address',
        house: houseNumber,
        streetName: finalStreetName,
        streetType: finalStreetType,
        borough: borough,
      });
      
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode?${params.toString()}`;
      console.log('[geocode] url:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.userMessage || errorData.error || 'Geocoding failed');
      }

      const geocodeData = await response.json();
      const bbl = geocodeData.bbl;

      if (!bbl) {
        console.error('[search] geocode response missing bbl:', geocodeData);
        setError('Geocoding succeeded but no BBL was returned. Please try again.');
        setLoading(false);
        return;
      }

      const bbl10 = String(bbl).padStart(10, '0');
      console.log('[search] geocode success bbl:', bbl10);

      // Navigate with BBL (and optional address for display)
      const address = geocodeData.address || '';
      const resultParams = new URLSearchParams({ bbl: bbl10 });
      if (address) {
        resultParams.set('address', address);
      }
      if (geocodeData.bin) {
        resultParams.set('bin', geocodeData.bin);
      }
      if (geocodeData.latitude) {
        resultParams.set('lat', String(geocodeData.latitude));
      }
      if (geocodeData.longitude) {
        resultParams.set('lon', String(geocodeData.longitude));
      }
      resultParams.set('borough', geocodeData.borough || borough);

      navigate(`/results?${resultParams.toString()}`);
    } catch (err) {
      console.error('[search] geocode error:', err);
      setError(err instanceof Error ? err.message : 'Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBblSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bblBorough || !block || !lot) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        type: 'bbl',
        borough: bblBorough,
        block: block,
        lot: lot,
      });
      
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode?${params.toString()}`;
      console.log('[geocode] url:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.userMessage || errorData.error || 'BBL lookup failed');
      }

      const geocodeData = await response.json();
      const bbl = geocodeData.bbl;

      if (!bbl) {
        console.error('[search] BBL geocode response missing bbl:', geocodeData);
        setError('BBL lookup succeeded but no BBL was returned. Please try again.');
        setLoading(false);
        return;
      }

      const bbl10 = String(bbl).padStart(10, '0');
      console.log('[search] geocode success bbl:', bbl10);

      // Navigate with BBL
      const resultParams = new URLSearchParams({ bbl: bbl10 });
      if (geocodeData.address) {
        resultParams.set('address', geocodeData.address);
      }
      if (geocodeData.bin) {
        resultParams.set('bin', geocodeData.bin);
      }
      if (geocodeData.latitude) {
        resultParams.set('lat', String(geocodeData.latitude));
      }
      if (geocodeData.longitude) {
        resultParams.set('lon', String(geocodeData.longitude));
      }
      if (geocodeData.borough) {
        resultParams.set('borough', geocodeData.borough);
      }

      navigate(`/results?${resultParams.toString()}`);
    } catch (err) {
      console.error('[search] BBL geocode error:', err);
      setError(err instanceof Error ? err.message : 'Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-lg">
      <CardContent className="p-6">
        <Tabs value={searchType} onValueChange={(v) => setSearchType(v as 'address' | 'bbl')}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="address" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Address Search
            </TabsTrigger>
            <TabsTrigger value="bbl" className="flex items-center gap-2">
              <Grid3X3 className="h-4 w-4" />
              BBL Search
            </TabsTrigger>
          </TabsList>

          <TabsContent value="address">
            <form onSubmit={handleAddressSearch} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="houseNumber">House Number</Label>
                  <Input
                    id="houseNumber"
                    placeholder="123"
                    value={houseNumber}
                    onChange={(e) => setHouseNumber(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="streetName">Street Name</Label>
                  <Input
                    id="streetName"
                    placeholder="Carroll, Broadway, East 2"
                    value={streetName}
                    onChange={(e) => setStreetName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="streetType">Street Type</Label>
                  <Select value={streetType} onValueChange={setStreetType}>
                    <SelectTrigger id="streetType">
                      <SelectValue placeholder="Type (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {STREET_TYPES.map((st) => (
                        <SelectItem key={st.value} value={st.value}>
                          {st.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Select suffix or None for Broadway</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="borough">Borough</Label>
                <Select value={borough} onValueChange={(v) => setBorough(v as Borough)}>
                  <SelectTrigger id="borough">
                    <SelectValue placeholder="Select borough" />
                  </SelectTrigger>
                  <SelectContent>
                    {BOROUGHS.map((b) => (
                      <SelectItem key={b.value} value={b.value}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {error && searchType === 'address' && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                {loading ? 'Searching...' : 'Search Property'}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="bbl">
            <form onSubmit={handleBblSearch} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="bblBorough">Borough</Label>
                  <Input
                    id="bblBorough"
                    placeholder="1"
                    value={bblBorough}
                    onChange={(e) => setBblBorough(e.target.value)}
                    maxLength={1}
                    required
                  />
                  <p className="text-xs text-muted-foreground">1-5</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="block">Block</Label>
                  <Input
                    id="block"
                    placeholder="00123"
                    value={block}
                    onChange={(e) => setBlock(e.target.value)}
                    maxLength={5}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lot">Lot</Label>
                  <Input
                    id="lot"
                    placeholder="0001"
                    value={lot}
                    onChange={(e) => setLot(e.target.value)}
                    maxLength={4}
                    required
                  />
                </div>
              </div>
              {error && searchType === 'bbl' && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Search className="h-4 w-4 mr-2" />
                )}
                {loading ? 'Searching...' : 'Search by BBL'}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
