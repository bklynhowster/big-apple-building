import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, Grid3X3 } from 'lucide-react';
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

export function SearchForm() {
  const navigate = useNavigate();
  const [searchType, setSearchType] = useState<'address' | 'bbl'>('address');
  
  // Address search state
  const [houseNumber, setHouseNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [streetType, setStreetType] = useState('');
  const [borough, setBorough] = useState<Borough | ''>('');
  
  // BBL search state
  const [bblBorough, setBblBorough] = useState('');
  const [block, setBlock] = useState('');
  const [lot, setLot] = useState('');

  const handleAddressSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!houseNumber || !streetName || !streetType || !borough) return;
    
    const params = new URLSearchParams({
      type: 'address',
      house: houseNumber,
      streetName: streetName,
      streetType: streetType,
      borough: borough,
    });
    navigate(`/results?${params.toString()}`);
  };

  const handleBblSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bblBorough || !block || !lot) return;
    
    const params = new URLSearchParams({
      type: 'bbl',
      borough: bblBorough,
      block: block,
      lot: lot,
    });
    navigate(`/results?${params.toString()}`);
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
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {STREET_TYPES.map((st) => (
                        <SelectItem key={st.value} value={st.value}>
                          {st.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">St, Ave, Rd, etc.</p>
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
              <Button type="submit" className="w-full" size="lg">
                <Search className="h-4 w-4 mr-2" />
                Search Property
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
              <Button type="submit" className="w-full" size="lg">
                <Search className="h-4 w-4 mr-2" />
                Search by BBL
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
