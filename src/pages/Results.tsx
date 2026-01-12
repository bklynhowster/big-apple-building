import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PropertyHeader } from '@/components/results/PropertyHeader';
import { SummaryTab } from '@/components/results/SummaryTab';
import { ViolationsTab } from '@/components/results/ViolationsTab';
import { ECBTab } from '@/components/results/ECBTab';
import { SafetyTab } from '@/components/results/SafetyTab';
import { PermitsTab } from '@/components/results/PermitsTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { usePropertySearch } from '@/hooks/usePropertySearch';

export default function Results() {
  const [searchParams] = useSearchParams();
  const { loading, error, data, bbl } = usePropertySearch();
  const [activeTab, setActiveTab] = useState('summary');

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  // Missing BBL state - shown when we can't determine the property
  const showMissingBBL = !loading && !error && !bbl;

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-1 bg-muted/30">
        <div className="container mx-auto px-4 py-6">
          {/* Back Navigation */}
          <div className="mb-6">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                New Search
              </Button>
            </Link>
          </div>

          {/* Loading State */}
          {loading && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <Loader2 className="h-8 w-8 text-primary animate-spin mb-4" />
                <p className="text-muted-foreground">Fetching property records...</p>
              </CardContent>
            </Card>
          )}

          {/* Error State */}
          {error && !loading && (
            <Card className="border-destructive/50">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-8 w-8 text-destructive mb-4" />
                <p className="text-foreground font-medium mb-2">Unable to fetch property data</p>
                <p className="text-sm text-muted-foreground mb-4">{error}</p>
                <Link to="/">
                  <Button variant="outline">Return to Search</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Missing BBL State */}
          {showMissingBBL && (
            <Card className="border-warning/50">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-8 w-8 text-warning mb-4" />
                <p className="text-foreground font-medium mb-2">Missing property identifier (BBL)</p>
                <p className="text-sm text-muted-foreground mb-4">Please run the search again.</p>
                <Link to="/">
                  <Button variant="outline">Return to Search</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Results - only render when we have both data and a valid bbl */}
          {data && bbl && !loading && (
            <div className="space-y-6">
              <PropertyHeader info={data.info} />
              
              <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="w-full justify-start bg-card border-b border-border rounded-none h-auto p-0 flex-wrap">
                  <TabsTrigger 
                    value="summary" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                  >
                    Summary
                  </TabsTrigger>
                  <TabsTrigger 
                    value="violations" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                  >
                    Violations
                  </TabsTrigger>
                  <TabsTrigger 
                    value="ecb" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                  >
                    ECB
                  </TabsTrigger>
                  <TabsTrigger 
                    value="safety" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                  >
                    Safety
                  </TabsTrigger>
                  <TabsTrigger 
                    value="permits" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                  >
                    Permits
                  </TabsTrigger>
                </TabsList>

                <div className="mt-6">
                  <TabsContent value="summary" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <SummaryTab 
                          bbl={bbl} 
                          address={data.info.address}
                          onTabChange={handleTabChange}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="violations" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ViolationsTab bbl={bbl} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="ecb" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ECBTab bbl={bbl} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="safety" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <SafetyTab bbl={bbl} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="permits" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <PermitsTab bbl={bbl} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          )}
        </div>
      </main>
      
      <Footer />
    </div>
  );
}
