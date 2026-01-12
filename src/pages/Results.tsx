import { useMemo, useState, useCallback, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Building2, Home } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { PropertyOverview } from '@/components/results/PropertyOverview';
import { PropertyProfileCard } from '@/components/results/PropertyProfileCard';
import { CondoUnitsCard } from '@/components/results/CondoUnitsCard';
import { SummaryTab } from '@/components/results/SummaryTab';
import { ViolationsTab } from '@/components/results/ViolationsTab';
import { ECBTab } from '@/components/results/ECBTab';
import { SafetyTab } from '@/components/results/SafetyTab';
import { PermitsTab } from '@/components/results/PermitsTab';
import { AllRecordsTab } from '@/components/results/AllRecordsTab';
import { HPDTab } from '@/components/results/HPDTab';
import { ThreeOneOneTab } from '@/components/results/ThreeOneOneTab';
import { QueryDebugPanel } from '@/components/results/QueryDebugPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useQueryDebug } from '@/contexts/QueryDebugContext';

const VALID_TABS = ['summary', 'violations', 'ecb', 'safety', 'permits', 'hpd', '311', 'all'] as const;
type ValidTab = typeof VALID_TABS[number];

function normalizeBBL(bbl: string | null): string {
  if (!bbl) return '';
  const padded = String(bbl).padStart(10, '0');
  return padded.length === 10 ? padded : '';
}

function isValidTab(tab: string | null): tab is ValidTab {
  return tab !== null && VALID_TABS.includes(tab as ValidTab);
}

export default function Results() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setContextInfo } = useQueryDebug();

  // Read all params from URL
  const params = useMemo(() => {
    return new URLSearchParams(location.search);
  }, [location.search]);

  // Initialize active tab from URL or default to 'summary'
  const initialTab = useMemo(() => {
    const tabParam = params.get('tab');
    return isValidTab(tabParam) ? tabParam : 'summary';
  }, [params]);

  const [activeTab, setActiveTab] = useState<string>(initialTab);

  const bbl = useMemo(() => normalizeBBL(params.get('bbl')), [params]);
  const address = params.get('address') || '';
  const borough = params.get('borough') || '';
  const bin = params.get('bin') || '';
  const latitude = params.get('lat') ? parseFloat(params.get('lat')!) : undefined;
  const longitude = params.get('lon') ? parseFloat(params.get('lon')!) : undefined;

  const isValidBBL = bbl.length === 10;

  // State for passing keyword filter to tabs from "View in tab"
  const [tabKeywordFilter, setTabKeywordFilter] = useState<string | undefined>();
  
  // Context switching state for condos
  const [contextBbl, setContextBbl] = useState<string>(bbl);
  const [isUnitContext, setIsUnitContext] = useState<boolean>(false);
  const [currentUnitLabel, setCurrentUnitLabel] = useState<string | null>(null);
  const [billingBbl, setBillingBbl] = useState<string | null>(null);
  
  // Update context BBL when main BBL changes
  useEffect(() => {
    setContextBbl(bbl);
    setIsUnitContext(false);
    setCurrentUnitLabel(null);
  }, [bbl]);
  
  // Update debug context whenever context changes
  useEffect(() => {
    setContextInfo(contextBbl, billingBbl, bin || null);
  }, [contextBbl, billingBbl, bin, setContextInfo]);
  
  // Handle context switch from condo units card
  const handleContextChange = useCallback((newContextBbl: string, isUnit: boolean) => {
    setContextBbl(newContextBbl);
    setIsUnitContext(isUnit);
  }, []);

  // Sync tab changes to URL
  const handleTabChange = useCallback((tab: string, keyword?: string) => {
    setActiveTab(tab);
    setTabKeywordFilter(keyword);
    
    // Update URL with new tab (without full navigation)
    const newParams = new URLSearchParams(location.search);
    if (tab === 'summary') {
      newParams.delete('tab'); // Default tab, no need in URL
    } else {
      newParams.set('tab', tab);
    }
    const newUrl = `${location.pathname}?${newParams.toString()}`;
    window.history.replaceState(null, '', newUrl);
  }, [location.search, location.pathname]);

  const handleViewInTab = useCallback((tab: string, keyword?: string) => {
    handleTabChange(tab, keyword);
  }, [handleTabChange]);

  // Sync from URL when it changes externally (e.g., back/forward navigation)
  useEffect(() => {
    const tabParam = params.get('tab');
    const validTab = isValidTab(tabParam) ? tabParam : 'summary';
    if (validTab !== activeTab) {
      setActiveTab(validTab);
    }
  }, [params]);

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

          {/* Missing/Invalid BBL State */}
          {!isValidBBL && (
            <Card className="border-destructive/50">
              <CardContent className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-8 w-8 text-destructive mb-4" />
                <p className="text-foreground font-medium mb-2">Missing property identifier (BBL)</p>
                <p className="text-sm text-muted-foreground mb-4">Please run the search again.</p>
                <Link to="/">
                  <Button variant="outline">Return to Search</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Results - render tabs only when we have a valid BBL */}
          {isValidBBL && (
            <div className="space-y-6">
              {/* Query Debug Panel - visible when ?debug=1 */}
              <QueryDebugPanel />
              
              {/* Property Overview */}
              <PropertyOverview
                bbl={bbl}
                address={address}
                borough={borough}
                bin={bin}
                latitude={latitude}
                longitude={longitude}
                unitLabel={currentUnitLabel}
              />

              {/* Property Profile */}
              <PropertyProfileCard bbl={bbl} />
              
              {/* Condo Units Discovery */}
              <CondoUnitsCard 
                bbl={bbl} 
                onContextChange={handleContextChange} 
                onUnitLabelResolved={setCurrentUnitLabel}
                onBillingBblResolved={setBillingBbl}
              />
              
              {/* Context Indicator - show when viewing unit vs building context */}
              {contextBbl !== bbl && (
                <div className="flex items-center gap-3 p-3 bg-primary/10 border border-primary/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    {isUnitContext ? (
                      <Home className="h-4 w-4 text-primary" />
                    ) : (
                      <Building2 className="h-4 w-4 text-primary" />
                    )}
                    <span className="text-sm font-medium">
                      {isUnitContext ? 'Unit Context' : 'Building Context'}
                    </span>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {contextBbl}
                    </Badge>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleContextChange(bbl, false)}
                    className="ml-auto"
                  >
                    Reset to original
                  </Button>
                </div>
              )}

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
                  <TabsTrigger 
                    value="hpd" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                  >
                    HPD
                  </TabsTrigger>
                  <TabsTrigger 
                    value="311" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                  >
                    311 Nearby
                  </TabsTrigger>
                  <TabsTrigger 
                    value="all" 
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                  >
                    All Records
                  </TabsTrigger>
                </TabsList>

                <div className="mt-6">
                  <TabsContent value="summary" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <SummaryTab 
                          bbl={contextBbl}
                          onTabChange={handleTabChange}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="violations" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ViolationsTab bbl={contextBbl} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="ecb" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ECBTab bbl={contextBbl} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="safety" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <SafetyTab bbl={contextBbl} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="permits" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <PermitsTab bbl={contextBbl} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="hpd" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <HPDTab bbl={contextBbl} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="311" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ThreeOneOneTab lat={latitude} lon={longitude} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="all" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <AllRecordsTab bbl={contextBbl} onViewInTab={handleViewInTab} />
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
