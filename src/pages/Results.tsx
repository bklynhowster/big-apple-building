import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, Building2, Home } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ContextBanner, QueryScope } from '@/components/results/ContextBanner';
import { PropertyOverview } from '@/components/results/PropertyOverview';
import { PropertyProfileCard } from '@/components/results/PropertyProfileCard';
import { RiskSnapshotCard, type RecordCounts, type LoadingStates } from '@/components/results/RiskSnapshotCard';
import brooklynBridgeLines from '@/assets/brooklyn-bridge-lines.png';

import { CondoUnitsCard } from '@/components/results/CondoUnitsCard';
import { ResidentialUnitsCard } from '@/components/results/ResidentialUnitsCard';
import { UnitInsightsCard } from '@/components/results/UnitInsightsCard';
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
import { usePropertyProfile } from '@/hooks/usePropertyProfile';
import { useHPDViolations, useHPDComplaints } from '@/hooks/useHPD';
import { use311 } from '@/hooks/use311';
import { useCoopUnitRoster } from '@/hooks/useCoopUnitRoster';
import { useDobJobFilings } from '@/hooks/useDobJobFilings';
import { useViolations } from '@/hooks/useViolations';
import { useECB } from '@/hooks/useECB';
import { usePermits } from '@/hooks/usePermits';
import { useLandmarkStatus } from '@/hooks/useLandmarkStatus';

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
  const unitContextParam = params.get('unitContext') || null;

  const isValidBBL = bbl.length === 10;

  // Get property profile to detect co-op status
  const { profile } = usePropertyProfile(isValidBBL ? bbl : null);
  const isCoop = profile?.propertyTenure === 'COOP';

  // Pre-fetch HPD, 311, Rolling Sales, DOB Filings, DOB Violations, ECB, and Permits for Risk Snapshot + Unit Insights
  const hpdViolations = useHPDViolations(isValidBBL ? bbl : null);
  const hpdComplaints = useHPDComplaints(isValidBBL ? bbl : null);
  const threeOneOne = use311(latitude, longitude);
  const coopUnitRoster = useCoopUnitRoster();
  const dobJobFilings = useDobJobFilings();
  const dobViolationsHook = useViolations(isValidBBL ? bbl : null);
  const ecbHook = useECB(isValidBBL ? bbl : null);
  const permitsHook = usePermits(isValidBBL ? bbl : null);
  
  // Landmark status lookup - pass PLUTO histdist if available for quick detection
  const plutoHistDist = profile?.raw?.histdist as string | undefined;
  const landmarkStatus = useLandmarkStatus({ 
    bbl, 
    bin, 
    lat: latitude, 
    lon: longitude, 
    plutoHistDist 
  });
  
  // Track if we've fetched data for insights/risk snapshot
  const dataFetchedRef = useRef(false);
  
  // Fetch all data for Risk Snapshot and Unit Insights
  useEffect(() => {
    if (!isValidBBL || dataFetchedRef.current) return;
    if (!bbl || bbl.length !== 10) return;

    hpdViolations.fetch(bbl);
    hpdComplaints.fetch(bbl);
    dobViolationsHook.fetchViolations(bbl);
    ecbHook.fetchECB(bbl);
    permitsHook.fetchPermits(bbl);
    
    // Co-op specific data
    if (isCoop) {
      coopUnitRoster.fetch(bbl);
    }
    
    if (bin) {
      dobJobFilings.fetch(bin);
    }
    if (latitude !== undefined && longitude !== undefined) {
      threeOneOne.fetch(latitude, longitude);
    }
    dataFetchedRef.current = true;
  }, [isValidBBL, bbl, bin, latitude, longitude, isCoop]);
  
  // Compute record counts for Risk Snapshot
  const recordCounts: RecordCounts = useMemo(() => {
    const countOpen = <T extends { status?: string }>(items: T[]) => 
      items.filter(item => item.status === 'open').length;
    
    return {
      dobViolations: dobViolationsHook.items.length,
      dobViolationsOpen: countOpen(dobViolationsHook.items),
      ecbViolations: ecbHook.items.length,
      ecbViolationsOpen: countOpen(ecbHook.items),
      hpdViolations: hpdViolations.items.length,
      hpdViolationsOpen: hpdViolations.items.filter(item => item.status === 'open').length,
      hpdComplaints: hpdComplaints.items.length,
      hpdComplaintsOpen: hpdComplaints.items.filter(item => item.status === 'open').length,
      serviceRequests: threeOneOne.items.length,
      serviceRequestsOpen: threeOneOne.items.filter(item => item.status === 'open').length,
      dobPermits: permitsHook.items.length,
      salesRecords: coopUnitRoster.units.length,
      dobFilingsUnits: dobJobFilings.units.length,
    };
  }, [
    dobViolationsHook.items,
    ecbHook.items,
    hpdViolations.items,
    hpdComplaints.items,
    threeOneOne.items,
    permitsHook.items,
    coopUnitRoster.units,
    dobJobFilings.units,
  ]);
  
  const riskSnapshotLoading: LoadingStates = useMemo(() => ({
    dobViolations: dobViolationsHook.loading,
    ecbViolations: ecbHook.loading,
    hpdViolations: hpdViolations.loading,
    hpdComplaints: hpdComplaints.loading,
    serviceRequests: threeOneOne.loading,
    dobPermits: permitsHook.loading,
    salesRecords: coopUnitRoster.loading,
    dobFilingsUnits: dobJobFilings.loading,
  }), [
    dobViolationsHook.loading,
    ecbHook.loading,
    hpdViolations.loading,
    hpdComplaints.loading,
    threeOneOne.loading,
    permitsHook.loading,
    coopUnitRoster.loading,
    dobJobFilings.loading,
  ]);

  // State for passing keyword filter to tabs from "View in tab"
  const [tabKeywordFilter, setTabKeywordFilter] = useState<string | undefined>();
  
  // Condo and scope state
  const [billingBbl, setBillingBbl] = useState<string | null>(null);
  const [currentUnitLabel, setCurrentUnitLabel] = useState<string | null>(null);
  const [hasCondoUnits, setHasCondoUnits] = useState(false);
  
  // Co-op unit context (UI-only, no API calls) - initialized from URL
  const [coopUnitContext, setCoopUnitContext] = useState<string | null>(unitContextParam);
  
  // Ref to tabs section for scrolling
  const tabsRef = useRef<HTMLDivElement>(null);
  
  // Determine if current BBL is a unit lot (1001-6999) or billing lot (75xx)
  const lotNumber = useMemo(() => {
    if (bbl.length !== 10) return 0;
    return parseInt(bbl.slice(6), 10);
  }, [bbl]);
  
  const isUnitLot = lotNumber >= 1001 && lotNumber <= 6999;
  const isBillingLot = lotNumber >= 7500 && lotNumber <= 7599;
  
  // Scope defaults: unit lot -> unit scope, billing lot -> building scope
  // For co-ops, always use building scope (no unit-level data)
  const [scope, setScope] = useState<QueryScope>(() => {
    return isUnitLot && !isCoop ? 'unit' : 'building';
  });
  
  // The BBL to use for queries based on scope
  const queryBbl = useMemo(() => {
    // Co-ops always query at building level
    if (isCoop) return bbl;
    if (scope === 'building' && billingBbl) {
      return billingBbl;
    }
    return bbl;
  }, [scope, billingBbl, bbl, isCoop]);
  
  // Update scope default when BBL changes or co-op status changes
  useEffect(() => {
    if (isCoop) {
      setScope('building');
    } else {
      setScope(isUnitLot ? 'unit' : 'building');
    }
    setCurrentUnitLabel(null);
    // Only reset co-op unit context if BBL changes (not on initial mount if URL has unitContext)
    if (!unitContextParam) {
      setCoopUnitContext(null);
    }
  }, [bbl, isUnitLot, isCoop]);
  
  // Sync co-op unit context from URL on external navigation (back/forward)
  useEffect(() => {
    if (isCoop && unitContextParam !== coopUnitContext) {
      setCoopUnitContext(unitContextParam);
    }
  }, [unitContextParam, isCoop]);

  // Update URL when co-op unit context changes
  const handleCoopUnitContextChange = useCallback((unit: string | null) => {
    setCoopUnitContext(unit);
    
    // Update URL with unitContext param
    const newParams = new URLSearchParams(location.search);
    if (unit) {
      newParams.set('unitContext', unit);
    } else {
      newParams.delete('unitContext');
    }
    const newUrl = `${location.pathname}?${newParams.toString()}`;
    window.history.replaceState(null, '', newUrl);
  }, [location.search, location.pathname]);

  // Handle unit selection from Unit Insights and scroll to tabs
  const handleUnitInsightSelect = useCallback((unit: string) => {
    handleCoopUnitContextChange(unit);
    // Scroll to tabs after a short delay for state update
    setTimeout(() => {
      tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, [handleCoopUnitContextChange]);

  // Clear unit context
  const handleClearUnitContext = useCallback(() => {
    handleCoopUnitContextChange(null);
  }, [handleCoopUnitContextChange]);
  
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
      
      <main className="flex-1 bg-muted/30 relative">
        {/* Subtle Brooklyn Bridge fragment - header area only */}
        <div 
          className="absolute top-0 left-0 right-0 h-48 pointer-events-none overflow-hidden"
          aria-hidden="true"
        >
          <div 
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${brooklynBridgeLines})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center top',
              opacity: 0.025,
              filter: 'grayscale(0.3)',
              maskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 100%)',
            }}
          />
        </div>
        
        <div className="container mx-auto px-4 py-6 relative z-10">

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
                isCondoUnit={hasCondoUnits && isUnitLot && !isCoop}
                isCoop={isCoop}
                coopUnitContext={coopUnitContext}
                onCoopUnitContextChange={isCoop ? handleCoopUnitContextChange : undefined}
                scope={scope}
                onScopeChange={setScope}
              />

              {/* Risk Snapshot - Building-level risk signals summary */}
              <RiskSnapshotCard 
                counts={recordCounts} 
                loading={riskSnapshotLoading} 
              />

              {/* Property Profile with embedded map */}
              <PropertyProfileCard 
                bbl={bbl} 
                unitLabel={currentUnitLabel}
                parentAddress={address}
                landmarkStatus={landmarkStatus}
                lat={latitude}
                lon={longitude}
              />
              
              {/* Condo Units Discovery - only show when NOT on a unit page and NOT a co-op */}
              {!isUnitLot && !isCoop && (
                <CondoUnitsCard 
                  bbl={bbl} 
                  onUnitLabelResolved={setCurrentUnitLabel}
                  onBillingBblResolved={handleBillingBblResolved}
                />
              )}
              
              {/* Hidden component to resolve billing BBL when on unit page */}
              {isUnitLot && !isCoop && (
                <CondoUnitsCard 
                  bbl={bbl} 
                  onUnitLabelResolved={setCurrentUnitLabel}
                  onBillingBblResolved={handleBillingBblResolved}
                  hidden
                />
              )}

              {/* Residential Units Card - Co-ops only (informational unit enumeration) */}
              {isCoop && (
                <ResidentialUnitsCard
                  buildingBbl={bbl}
                  selectedUnit={coopUnitContext}
                  onUnitSelect={handleCoopUnitContextChange}
                />
              )}

              {/* Mentioned Units Card - Co-ops only (derived from DOB Filings + HPD + 311 + Sales + Violations + Permits) */}
              {isCoop && (
                <UnitInsightsCard
                  buildingBbl={bbl}
                  bin={bin}
                  hpdViolations={hpdViolations.items}
                  hpdComplaints={hpdComplaints.items}
                  serviceRequests={threeOneOne.items}
                  salesUnits={coopUnitRoster.units}
                  dobFilingsUnits={dobJobFilings.units}
                  dobFilings={dobJobFilings.filings}
                  dobViolations={dobViolationsHook.items}
                  ecbViolations={ecbHook.items}
                  dobPermits={permitsHook.items}
                  selectedUnit={coopUnitContext}
                  onUnitSelect={handleUnitInsightSelect}
                  onClearUnitFilter={() => handleCoopUnitContextChange(null)}
                  loadingStates={{
                    filings: dobJobFilings.loading || coopUnitRoster.loading,
                    permits: permitsHook.loading,
                    hpd: hpdViolations.loading || hpdComplaints.loading,
                    threeOneOne: threeOneOne.loading,
                    violations: dobViolationsHook.loading,
                    ecb: ecbHook.loading,
                  }}
                  rosterError={coopUnitRoster.error}
                  salesWarning={coopUnitRoster.warning}
                  dobNowUrl={dobJobFilings.dobNowUrl}
                  fallbackMode={dobJobFilings.fallbackMode}
                />
              )}

              <Tabs ref={tabsRef} value={activeTab} onValueChange={handleTabChange} className="w-full">
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
                          isCoop={isCoop}
                          coopUnitContext={coopUnitContext}
                          onTabChange={handleTabChange}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="violations" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ViolationsTab bbl={queryBbl} bin={bin} scope={scope} isCoop={isCoop} coopUnitContext={coopUnitContext} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="ecb" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ECBTab bbl={queryBbl} bin={bin} scope={scope} isCoop={isCoop} coopUnitContext={coopUnitContext} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="safety" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <SafetyTab bbl={queryBbl} bin={bin} scope={scope} isCoop={isCoop} coopUnitContext={coopUnitContext} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="permits" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <PermitsTab bbl={queryBbl} bin={bin} scope={scope} isCoop={isCoop} coopUnitContext={coopUnitContext} />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="hpd" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <HPDTab 
                          bbl={queryBbl} 
                          bin={bin} 
                          scope={scope} 
                          isCoop={isCoop} 
                          coopUnitContext={coopUnitContext}
                          onClearUnitContext={handleClearUnitContext}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                  
                  <TabsContent value="311" className="mt-0">
                    <Card>
                      <CardContent className="p-6">
                        <ThreeOneOneTab 
                          lat={latitude} 
                          lon={longitude} 
                          scope={scope}
                          isCoop={isCoop}
                          coopUnitContext={coopUnitContext}
                          onClearUnitContext={handleClearUnitContext}
                        />
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
