import { useMemo, useState, useCallback, useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Building2, Home } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ContextBanner, QueryScope } from '@/components/results/ContextBanner';
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
  
  // Condo and scope state
  const [billingBbl, setBillingBbl] = useState<string | null>(null);
  const [currentUnitLabel, setCurrentUnitLabel] = useState<string | null>(null);
  const [hasCondoUnits, setHasCondoUnits] = useState(false);
  
  // Determine if current BBL is a unit lot (1001-6999) or billing lot (75xx)
  const lotNumber = useMemo(() => {
    if (bbl.length !== 10) return 0;
    return parseInt(bbl.slice(6), 10);
  }, [bbl]);
  
  const isUnitLot = lotNumber >= 1001 && lotNumber <= 6999;
  const isBillingLot = lotNumber >= 7500 && lotNumber <= 7599;
  
  // Scope defaults: unit lot -> unit scope, billing lot -> building scope
  const [scope, setScope] = useState<QueryScope>(() => {
    return isUnitLot ? 'unit' : 'building';
  });
  
  // The BBL to use for queries based on scope
  const queryBbl = useMemo(() => {
    if (scope === 'building' && billingBbl) {
      return billingBbl;
    }
    return bbl;
  }, [scope, billingBbl, bbl]);
  
  // Update scope default when BBL changes
  useEffect(() => {
    setScope(isUnitLot ? 'unit' : 'building');
    setCurrentUnitLabel(null);
  }, [bbl, isUnitLot]);
  
  // Update debug context whenever context changes
  useEffect(() => {
    setContextInfo(queryBbl, billingBbl, bin || null);
  }, [queryBbl, billingBbl, bin, setContextInfo]);
  
  // Handle billing BBL resolution from condo units card
  const handleBillingBblResolved = useCallback((resolvedBillingBbl: string) => {
    setBillingBbl(resolvedBillingBbl);
    setHasCondoUnits(true);
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

  // Update document title based on context
  useEffect(() => {
    const isCondoUnit = hasCondoUnits && isUnitLot;
    if (isCondoUnit && currentUnitLabel && address) {
      document.title = `${address} — Unit ${currentUnitLabel} | Property Search`;
    } else if (address) {
      document.title = `${address} | Property Search`;
    } else if (bbl) {
      document.title = `BBL ${bbl} | Property Search`;
    } else {
      document.title = 'Property Search';
    }
    
    return () => {
      document.title = 'Property Search';
    };
  }, [address, currentUnitLabel, hasCondoUnits, isUnitLot, bbl]);

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-1 bg-muted/30">
        <div className="container mx-auto px-4 py-6">

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
              
              {/* Context Banner - Primary navigation and scope control */}
              <ContextBanner
                address={address}
                unitLabel={currentUnitLabel}
                unitBbl={bbl}
                billingBbl={billingBbl}
                bin={bin}
                borough={borough}
                isCondoUnit={hasCondoUnits && isUnitLot}
                scope={scope}
                onScopeChange={setScope}
              />

              {/* Property Profile */}
              <PropertyProfileCard bbl={bbl} />
              
              {/* Condo Units Discovery - only show when NOT on a unit page */}
              {!isUnitLot && (
                <CondoUnitsCard 
                  bbl={bbl} 
                  onUnitLabelResolved={setCurrentUnitLabel}
                  onBillingBblResolved={handleBillingBblResolved}
                />
              )}
              
              {/* Hidden component to resolve billing BBL when on unit page */}
              {isUnitLot && (
                <CondoUnitsCard 
                  bbl={bbl} 
                  onUnitLabelResolved={setCurrentUnitLabel}
                  onBillingBblResolved={handleBillingBblResolved}
                  hidden
                />
              )}

              <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <div className="flex items-center justify-between bg-card border-b border-border">
                  <TabsList className="justify-start bg-transparent rounded-none h-auto p-0 flex-wrap">
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
                  
                  {/* Scope indicator badge for tabs */}
                  {hasCondoUnits && isUnitLot && (
                    <div className="px-4 py-2">
                      <Badge variant={scope === 'unit' ? 'default' : 'secondary'} className="text-xs">
                        {scope === 'unit' ? 'Unit view' : 'Building view'}
                      </Badge>
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <TabsContent value="summary" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <SummaryTab 
                          bbl={bbl}
                          billingBbl={billingBbl}
                          onTabChange={handleTabChange}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="violations" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ViolationsTab bbl={queryBbl} bin={bin} scope={scope} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="ecb" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ECBTab bbl={queryBbl} bin={bin} scope={scope} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="safety" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <SafetyTab bbl={queryBbl} bin={bin} scope={scope} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="permits" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <PermitsTab bbl={queryBbl} bin={bin} scope={scope} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="hpd" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <HPDTab bbl={queryBbl} bin={bin} scope={scope} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="311" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ThreeOneOneTab lat={latitude} lon={longitude} scope={scope} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="all" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <AllRecordsTab bbl={queryBbl} onViewInTab={handleViewInTab} />
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
