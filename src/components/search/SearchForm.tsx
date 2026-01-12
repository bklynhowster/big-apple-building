import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, Grid3X3, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { Borough } from '@/types/property';

const BOROUGHS: { value: Borough; label: string }[] = [
  { value: 'MANHATTAN', label: 'Manhattan' },
  { value: 'BRONX', label: 'Bronx' },
  { value: 'BROOKLYN', label: 'Brooklyn' },
  { value: 'QUEENS', label: 'Queens' },
  { value: 'STATEN ISLAND', label: 'Staten Island' },
];

// Sentinel value for "no street type selected" - Radix Select doesn't allow empty string values
const STREET_TYPE_NONE = '__NONE__';

const STREET_TYPES = [
  { value: STREET_TYPE_NONE, label: '(Auto-detect / None)' },
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

// Helper to convert UI street type value to request value
function getRequestStreetType(uiValue: string): string {
  return uiValue === STREET_TYPE_NONE ? '' : uiValue;
}

// Helper to convert request/state value to UI value for Select
function getUIStreetType(stateValue: string): string {
  return stateValue || STREET_TYPE_NONE;
}

// Suggestion structure from geocode API
interface StreetSuggestion {
  streetName: string;
  streetType?: string;
  borough?: string;
  label?: string; // Display label for the chip
}

// Error state with optional suggestions and debug info
interface SearchError {
  message: string;
  suggestions?: StreetSuggestion[];
  attemptedStreets?: string[];
  upstreamMessage?: string; // Raw message from Geoclient for debugging
}

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
  const [addressError, setAddressError] = useState<SearchError | null>(null);
  const [bblError, setBblError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  
  // Address search state
  const [houseNumber, setHouseNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [streetType, setStreetType] = useState(STREET_TYPE_NONE); // Use sentinel as default
  const [borough, setBorough] = useState<Borough | ''>('');
  
  // BBL search state
  const [bblBorough, setBblBorough] = useState('');
  const [block, setBlock] = useState('');
  const [lot, setLot] = useState('');

  // Handle clicking a suggestion chip
  const handleSuggestionClick = (suggestion: StreetSuggestion) => {
    setStreetName(suggestion.streetName);
    if (suggestion.streetType) {
      // Set the actual street type value (not the sentinel)
      setStreetType(suggestion.streetType);
    } else {
      // Reset to sentinel for "no selection"
      setStreetType(STREET_TYPE_NONE);
    }
    if (suggestion.borough) {
      const matchingBorough = BOROUGHS.find(
        b => b.value.toUpperCase() === suggestion.borough?.toUpperCase()
      );
      if (matchingBorough) {
        setBorough(matchingBorough.value);
      }
    }
    setAddressError(null);
  };

  const handleAddressSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!houseNumber || !streetName || !borough) return;
    
    setLoading(true);
    setAddressError(null);
    setShowDetails(false);
    
    // Convert UI street type to request value (sentinel -> empty string)
    const requestStreetType = getRequestStreetType(streetType);
    
    // Auto-detect suffix if streetType not explicitly set
    let finalStreetName = streetName.trim();
    let finalStreetType = requestStreetType;
    
    // If no street type selected, try to extract from street name
    if (!requestStreetType) {
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
        borough: borough,
      });
      
      // Only add streetType if it's not empty
      if (finalStreetType) {
        params.set('streetType', finalStreetType);
      }
      
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/geocode?${params.toString()}`;
      console.log('[geocode] url:', url);
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Handle 404 gracefully - this is a "not found" result, not an exception
        console.log('[search] geocode returned error:', data);
        
        const errorState: SearchError = {
          message: data.userMessage || data.error || 'Address not found. Check spelling and try again.',
          suggestions: data.suggestions,
          attemptedStreets: data.attemptedStreets,
          upstreamMessage: data.upstreamMessage || data.details,
        };
        
        setAddressError(errorState);
        setLoading(false);
        return;
      }

      const bbl = data.bbl;

      if (!bbl) {
        console.error('[search] geocode response missing bbl:', data);
        setAddressError({ message: 'Geocoding succeeded but no BBL was returned. Please try again.' });
        setLoading(false);
        return;
      }

      const bbl10 = String(bbl).padStart(10, '0');
      console.log('[search] geocode success bbl:', bbl10);

      // Navigate with BBL (and optional address for display)
      const address = data.address || '';
      const resultParams = new URLSearchParams({ bbl: bbl10 });
      if (address) {
        resultParams.set('address', address);
      }
      if (data.bin) {
        resultParams.set('bin', data.bin);
      }
      if (data.latitude) {
        resultParams.set('lat', String(data.latitude));
      }
      if (data.longitude) {
        resultParams.set('lon', String(data.longitude));
      }
      resultParams.set('borough', data.borough || borough);

      navigate(`/results?${resultParams.toString()}`);
    } catch (err) {
      console.error('[search] geocode error:', err);
      setAddressError({ 
        message: err instanceof Error ? err.message : 'Search failed. Please try again.' 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBblSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bblBorough || !block || !lot) return;
    
    setLoading(true);
    setBblError(null);
    
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
        setBblError(errorData.userMessage || errorData.error || 'BBL lookup failed');
        setLoading(false);
        return;
      }

      const geocodeData = await response.json();
      const bbl = geocodeData.bbl;

      if (!bbl) {
        console.error('[search] BBL geocode response missing bbl:', geocodeData);
        setBblError('BBL lookup succeeded but no BBL was returned. Please try again.');
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
      setBblError(err instanceof Error ? err.message : 'Search failed. Please try again.');
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
              {addressError && (
                <div className="text-sm bg-destructive/10 border border-destructive/30 p-3 rounded-md space-y-3">
                  <p className="text-destructive font-medium">{addressError.message}</p>
                  
                  {/* Did you mean... section with suggestion chips */}
                  {addressError.suggestions && addressError.suggestions.length > 0 && (
                    <div className="bg-card border border-border rounded-md p-3 space-y-2">
                      <p className="text-xs font-medium text-foreground">Did you mean…</p>
                      <div className="flex flex-wrap gap-2">
                        {addressError.suggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSuggestionClick(suggestion)}
                            className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                          >
                            {suggestion.label || `${suggestion.streetName}${suggestion.streetType ? ` ${suggestion.streetType}` : ''}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Collapsible debug details - only show when there's debug info */}
                  {(addressError.attemptedStreets?.length || addressError.upstreamMessage) && (
                    <Collapsible open={showDetails} onOpenChange={setShowDetails}>
                      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {showDetails ? 'Hide' : 'Show'} details
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2">
                        <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 space-y-2">
                          {addressError.upstreamMessage && (
                            <div>
                              <p className="font-medium mb-0.5">Geocoder response:</p>
                              <p className="font-mono text-[10px] break-all">{addressError.upstreamMessage}</p>
                            </div>
                          )}
                          {addressError.attemptedStreets && addressError.attemptedStreets.length > 0 && (
                            <div>
                              <p className="font-medium mb-1">Attempted variations:</p>
                              <ul className="list-disc list-inside space-y-0.5">
                                {addressError.attemptedStreets.map((street, idx) => (
                                  <li key={idx}>{street}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
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
              {bblError && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 p-3 rounded-md">
                  {bblError}
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
