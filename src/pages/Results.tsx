import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { ContextBanner, QueryScope } from '@/components/results/ContextBanner';
import { PropertyProfileCard } from '@/components/results/PropertyProfileCard';
import { RiskSnapshotCard, type RecordCounts, type LoadingStates, type RecordArrays, type NavigationInfo } from '@/components/results/RiskSnapshotCard';
import brooklynBridgeLines from '@/assets/brooklyn-bridge-lines.png';

import { ResidentialUnitsCard } from '@/components/results/ResidentialUnitsCard';
import { UnitInsightsCard } from '@/components/results/UnitInsightsCard';
import { CondoUnitsPreview } from '@/components/results/CondoUnitsPreview';
import { TaxesPanel } from '@/features/taxes';
import { OverviewTab } from '@/components/results/OverviewTab';
import { UnitsTab, type CondoMeta } from '@/components/results/UnitsTab';
import { RecordsTab } from '@/components/results/RecordsTab';
import { FinanceTab } from '@/components/results/FinanceTab';
import { QueryDebugPanel } from '@/components/results/QueryDebugPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MobileTabsList, MobileTabsTrigger } from '@/components/ui/mobile-tabs';
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
import { useIsMobileViewport } from '@/hooks/useBreakpoint';
import { useCondoUnits } from '@/hooks/useCondoUnits';

const VALID_TABS = ['overview', 'units', 'records', 'finance'] as const;
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
  const isMobile = useIsMobileViewport();
  const { setContextInfo } = useQueryDebug();

  // Read all params from URL
  const params = useMemo(() => {
    return new URLSearchParams(location.search);
  }, [location.search]);

  // Initialize active tab from URL or default to 'overview'
  const initialTab = useMemo(() => {
    const tabParam = params.get('tab');
    return isValidTab(tabParam) ? tabParam : 'overview';
  }, [params]);

  const [activeTab, setActiveTab] = useState<string>(initialTab);

  const bbl = useMemo(() => normalizeBBL(params.get('bbl')), [params]);
  const address = params.get('address') || '';
  const borough = params.get('borough') || '';
  const bin = params.get('bin') || '';
  const latitude = params.get('lat') ? parseFloat(params.get('lat')!) : undefined;
  const longitude = params.get('lon') ? parseFloat(params.get('lon')!) : undefined;
  const unitContextParam = params.get('unitContext') || null;
  
  // Building context params (passed when navigating from building to unit)
  const buildingAddressParam = params.get('buildingAddress') || '';
  const buildingBblParam = params.get('buildingBbl') || '';

  const isValidBBL = bbl.length === 10;
  
  // Determine if this is a unit lot early (needed for building profile fetch)
  const isUnitLotEarly = useMemo(() => {
    if (bbl.length !== 10) return false;
    const lot = parseInt(bbl.slice(6), 10);
    return lot >= 1001 && lot <= 6999;
  }, [bbl]);

  // ==========================================================================
  // EFFECTIVE BBL - Single canonical variable for ALL data fetching
  // ==========================================================================
  // view_bbl: the unit BBL the user clicked (from URL param 'bbl')
  // building_bbl: the condo parent BBL (from URL param 'buildingBbl')
  // effective_bbl: the BBL we actually query datasets with
  //
  // Condo rule: If user is in Unit view AND building_bbl exists, 
  // use building_bbl for ALL building-level datasets (HPD/ECB/DOB/etc.)
  // Unit BBLs do not have enforcement records in city databases.
  // ==========================================================================
  const effectiveBbl = useMemo(() => {
    // For condo unit pages, always use building BBL for data fetching
    if (isUnitLotEarly && buildingBblParam) {
      return buildingBblParam;
    }
    // Otherwise use the current BBL
    return bbl;
  }, [isUnitLotEarly, buildingBblParam, bbl]);

  // Track if we're showing building-level data for a unit page
  const isShowingBuildingContext = isUnitLotEarly && buildingBblParam && effectiveBbl === buildingBblParam;
  
  // Validate effective BBL
  const isEffectiveBblValid = effectiveBbl.length === 10;

  // Get property profile using the effective BBL (building for units, current for buildings)
  const { profile, loading: profileLoading } = usePropertyProfile(isEffectiveBblValid ? effectiveBbl : null);
  
  // Derive isCoopInferred from new two-layer ownership system:
  // Show as co-op if ownership.type === 'Cooperative' AND score >= 8
  const isCoopInferred = profile?.ownership?.type === 'Cooperative' && 
    (profile?.ownership?.coopLikelihoodScore ?? 0) >= 8;
  
  // Manual override state - synced from PropertyProfileCard
  const [isCoopEffective, setIsCoopEffective] = useState(false);
  
  // Update isCoopEffective when profile loads (initial state from inferred)
  useEffect(() => {
    if (profile) {
      // Check localStorage for override using effective BBL
      const storageKey = `elk_override:${effectiveBbl}`;
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored === 'COOP') {
          setIsCoopEffective(true);
        } else if (stored === 'NOT_COOP') {
          setIsCoopEffective(false);
        } else {
          setIsCoopEffective(isCoopInferred);
        }
      } catch {
        setIsCoopEffective(isCoopInferred);
      }
    }
  }, [profile, effectiveBbl, isCoopInferred]);
  
  // Handler for when PropertyProfileCard changes override
  const handleOwnershipOverrideChange = useCallback((effective: boolean) => {
    setIsCoopEffective(effective);
  }, []);
  
  // IMPORTANT: Mentioned Units visibility is NOT dependent on co-op status
  // isCoop is only used for co-op-specific UI (banners, unit context navigation)
  const isCoop = isCoopEffective;

  // Pre-fetch HPD, 311, Rolling Sales, DOB Filings, DOB Violations, ECB, and Permits for Risk Snapshot + Unit Insights
  // CRITICAL: All hooks use effectiveBbl (building BBL for condo units) to avoid scope mismatch
  const hpdViolations = useHPDViolations(isEffectiveBblValid ? effectiveBbl : null);
  const hpdComplaints = useHPDComplaints(isEffectiveBblValid ? effectiveBbl : null);
  const threeOneOne = use311(latitude, longitude);
  const coopUnitRoster = useCoopUnitRoster();
  const dobJobFilings = useDobJobFilings();
  const dobViolationsHook = useViolations(isEffectiveBblValid ? effectiveBbl : null);
  const ecbHook = useECB(isEffectiveBblValid ? effectiveBbl : null);
  const permitsHook = usePermits(isEffectiveBblValid ? effectiveBbl : null);
  
  // Condo roster - LIFTED to Results level for single source of truth
  const condoRoster = useCondoUnits();
  const [condoRosterQueryBbl, setCondoRosterQueryBbl] = useState<string | null>(null);
  
  // Landmark status lookup - pass PLUTO histdist if available for quick detection
  const plutoHistDist = profile?.raw?.histdist as string | undefined;
  const landmarkStatus = useLandmarkStatus({ 
    bbl: effectiveBbl, 
    bin, 
    lat: latitude, 
    lon: longitude, 
    plutoHistDist 
  });
  
  // Track if we've fetched data for insights/risk snapshot
  const dataFetchedRef = useRef(false);
  const lastFetchedBblRef = useRef<string | null>(null);
  const condoFetchedBblRef = useRef<string | null>(null);
  const condoBillingRefetchedRef = useRef<string | null>(null);
  
  // Fetch condo roster - separate from other fetches to handle billing BBL refetch
  useEffect(() => {
    if (!isEffectiveBblValid || isCoop) return;
    if (condoFetchedBblRef.current === effectiveBbl) return;
    
    condoFetchedBblRef.current = effectiveBbl;
    condoBillingRefetchedRef.current = null; // Reset billing refetch tracker
    setCondoRosterQueryBbl(effectiveBbl);
    condoRoster.fetchFirstPage(effectiveBbl);
  }, [isEffectiveBblValid, effectiveBbl, isCoop, condoRoster.fetchFirstPage]);
  
  // Handle billing BBL refetch: if response includes a different billingBbl, refetch with that
  useEffect(() => {
    if (!condoRoster.data) return;
    
    const { billingBbl, inputBbl, isCondo: isCondoResult } = condoRoster.data;
    
    // If it's a condo and billingBbl differs from what we queried, refetch with billingBbl
    if (isCondoResult && billingBbl && billingBbl !== inputBbl && condoBillingRefetchedRef.current !== billingBbl) {
      condoBillingRefetchedRef.current = billingBbl;
      setCondoRosterQueryBbl(billingBbl);
      condoRoster.fetchFirstPage(billingBbl);
    }
  }, [condoRoster.data, condoRoster.fetchFirstPage]);
  
  // Fetch all data for Risk Snapshot and Unit Insights
  // CRITICAL: All fetches use effectiveBbl to match hook initialization
  useEffect(() => {
    if (!isEffectiveBblValid) return;
    // Re-fetch if effectiveBbl changed
    if (lastFetchedBblRef.current === effectiveBbl && dataFetchedRef.current) return;

    hpdViolations.fetch(effectiveBbl);
    hpdComplaints.fetch(effectiveBbl);
    dobViolationsHook.fetchViolations(effectiveBbl);
    ecbHook.fetchECB(effectiveBbl);
    permitsHook.fetchPermits(effectiveBbl);
    
    // Co-op specific data
    if (isCoop) {
      coopUnitRoster.fetch(effectiveBbl);
    }
    
    if (bin) {
      dobJobFilings.fetch(bin);
    }
    if (latitude !== undefined && longitude !== undefined) {
      threeOneOne.fetch(latitude, longitude);
    }
    dataFetchedRef.current = true;
    lastFetchedBblRef.current = effectiveBbl;
  }, [isEffectiveBblValid, effectiveBbl, bin, latitude, longitude, isCoop]);
  
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
  
  // Record arrays for trend analysis
  const riskSnapshotRecords: RecordArrays = useMemo(() => ({
    dobViolations: dobViolationsHook.items,
    ecbViolations: ecbHook.items,
    hpdViolations: hpdViolations.items,
    hpdComplaints: hpdComplaints.items,
    serviceRequests: threeOneOne.items,
    dobPermits: permitsHook.items,
    // Sales and filings use lastSeen as proxy for trend analysis
    salesRecords: coopUnitRoster.units.map(u => ({ issueDate: u.lastSeen })),
    dobFilingsUnits: dobJobFilings.units.map(u => ({ issueDate: u.lastSeen })),
  }), [
    dobViolationsHook.items,
    ecbHook.items,
    hpdViolations.items,
    hpdComplaints.items,
    threeOneOne.items,
    permitsHook.items,
    coopUnitRoster.units,
    dobJobFilings.units,
  ]);

  // Condo metadata - derived from condoRoster.data (single source of truth)
  const condoMeta = useMemo<CondoMeta>(() => {
    if (isCoop || !condoRoster.data) {
      return { isCondo: false, billingBbl: null, totalUnits: 0, unitLabel: null };
    }
    
    const { isCondo, billingBbl, totalApprox, units, inputRole, inputBbl } = condoRoster.data;
    
    // Find current unit's label when input is a unit BBL
    let unitLabel: string | null = null;
    if (inputRole === 'unit' && units.length > 0) {
      const currentUnit = units.find((u) => u.unitBbl === inputBbl);
      if (currentUnit) {
        unitLabel = currentUnit.unitLabel;
      }
    }
    
    return {
      isCondo,
      billingBbl,
      totalUnits: totalApprox || units.length,
      unitLabel,
    };
  }, [isCoop, condoRoster.data]);
  
  // Derived condo state for convenience
  const billingBbl = condoMeta.billingBbl;
  const currentUnitLabel = condoMeta.unitLabel;
  const isCondoBuilding = condoMeta.isCondo;
  
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
  
  // Scope defaults: unit lot -> unit scope, billing lot -> building scope
  // For co-ops, always use building scope (no unit-level data)
  const [scope, setScope] = useState<QueryScope>(() => {
    return isUnitLot && !isCoop ? 'unit' : 'building';
  });
  
  // The BBL to use for queries based on scope
  // CRITICAL: For condo units, always use effectiveBbl (building BBL) regardless of scope
  // This ensures tabs show the same data as Risk Snapshot
  const queryBbl = useMemo(() => {
    // For condo unit pages, always use effectiveBbl (building BBL)
    if (isShowingBuildingContext) {
      return effectiveBbl;
    }
    // Co-ops always query at building level
    if (isCoop) return effectiveBbl;
    // For building pages with scope toggle
    if (scope === 'building' && billingBbl) {
      return billingBbl;
    }
    return effectiveBbl;
  }, [scope, billingBbl, effectiveBbl, isCoop, isShowingBuildingContext]);
  
  // Update scope default when BBL changes or co-op status changes
  useEffect(() => {
    if (isCoop) {
      setScope('building');
    } else {
      setScope(isUnitLot ? 'unit' : 'building');
    }
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

  // Ref to track programmatic tab changes (to avoid URL sync effect reverting them)
  const programmaticTabChangeRef = useRef(false);
  
  // Sync tab changes to URL
  const handleTabChange = useCallback((tab: string) => {
    programmaticTabChangeRef.current = true;
    setActiveTab(tab);
    
    // Update URL with new tab (without full navigation)
    const newParams = new URLSearchParams(location.search);
    if (tab === 'overview') {
      newParams.delete('tab'); // Default tab, no need in URL
    } else {
      newParams.set('tab', tab);
    }
    const newUrl = `${location.pathname}?${newParams.toString()}`;
    window.history.replaceState(null, '', newUrl);
    
    // Reset the ref after a tick (allow React to process state update)
    setTimeout(() => {
      programmaticTabChangeRef.current = false;
    }, 0);
  }, [location.search, location.pathname]);

  // Sync from URL when it changes externally (e.g., back/forward navigation)
  // Skip if we just made a programmatic change
  useEffect(() => {
    if (programmaticTabChangeRef.current) return;
    
    const tabParam = params.get('tab');
    const validTab = isValidTab(tabParam) ? tabParam : 'overview';
    if (validTab !== activeTab) {
      setActiveTab(validTab);
    }
  }, [params]);

  // Update document title based on context
  useEffect(() => {
    const isCondoUnit = isCondoBuilding && isUnitLot;
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
  }, [address, currentUnitLabel, isCondoBuilding, isUnitLot, bbl]);

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
        
        <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 relative z-10">

          {/* Missing/Invalid BBL State */}
          {!isValidBBL && (
            <Card className="border-destructive/50">
              <CardContent className="flex flex-col items-center justify-center py-12 sm:py-16">
                <AlertCircle className="h-8 w-8 text-destructive mb-4" />
                <p className="text-foreground font-medium mb-2 text-center">Missing property identifier (BBL)</p>
                <p className="text-sm text-muted-foreground mb-4 text-center">Please run the search again.</p>
                <Link to="/">
                  <Button variant="outline" className="min-h-[44px]">Return to Search</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Results - render tabs only when we have a valid BBL */}
          {isValidBBL && (
            <div className="space-y-4 sm:space-y-6">
              {/* Query Debug Panel - visible when ?debug=1 */}
              <QueryDebugPanel />
              
              {/* Context Banner - Primary navigation and scope control */}
              <ContextBanner
                address={address}
                unitLabel={currentUnitLabel}
                unitBbl={bbl}
                billingBbl={billingBbl || buildingBblParam}
                effectiveBbl={effectiveBbl}
                bin={bin}
                borough={borough}
                buildingAddress={buildingAddressParam}
                buildingProfile={profile ? {
                  yearBuilt: profile.yearBuilt,
                  buildingClass: profile.buildingClass,
                  totalUnits: profile.totalUnits,
                  residentialUnits: profile.residentialUnits,
                  numFloors: profile.numFloors,
                  grossSqFt: profile.grossSqFt,
                  propertyTypeLabel: profile.propertyTypeLabel,
                } : null}
                buildingProfileLoading={profileLoading}
                isCondoUnit={isCondoBuilding && isUnitLot && !isCoop}
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
                records={riskSnapshotRecords}
                onNavigateToSection={(info: NavigationInfo) => {
                  // Set scope to match dataset requirement
                  if (info.scope === 'building' && scope !== 'building') {
                    setScope('building');
                  } else if (info.scope === 'unit' && scope !== 'unit') {
                    setScope('unit');
                  }
                  // Navigate to tab
                  handleTabChange(info.tab);
                }}
              />

              {/* Property Profile with embedded map */}
              {/* Use effectiveBbl (building BBL for condo units) to avoid 404 on unit BBLs */}
              <PropertyProfileCard 
                bbl={effectiveBbl}
                unitLabel={currentUnitLabel}
                parentAddress={address}
                landmarkStatus={landmarkStatus}
                lat={latitude}
                lon={longitude}
                onOwnershipOverrideChange={handleOwnershipOverrideChange}
              />
              
              {/* Taxes - Single integration point via TaxesPanel */}
              <TaxesPanel
                context={isUnitLot ? 'unit' : 'building'}
                viewBbl={bbl}
                buildingBbl={buildingBblParam || billingBbl || undefined}
                address={address}
                isCondo={isCondoBuilding && !isUnitLot}
              />

              {/* Residential Units Card - Co-ops only (informational unit enumeration) */}
              {isCoop && (
                <ResidentialUnitsCard
                  buildingBbl={effectiveBbl}
                  selectedUnit={coopUnitContext}
                  onUnitSelect={handleCoopUnitContextChange}
                />
              )}

              {/* Condo Units Preview - Shows above Mentioned Units for condo buildings */}
              {!isCoop && !isUnitLot && (
                <CondoUnitsPreview
                  searchBbl={effectiveBbl}
                  rosterQueryBbl={condoRosterQueryBbl}
                  condoData={condoRoster.data}
                  loading={condoRoster.loading}
                  error={condoRoster.error}
                  isCoop={isCoop}
                  onViewAllUnits={() => handleTabChange('units')}
                  onSelectUnit={(unitBbl, unitLabel) => {
                    // Navigate to the unit's detail page with building context
                    const unitParams = new URLSearchParams();
                    unitParams.set('bbl', unitBbl);
                    unitParams.set('address', address);
                    unitParams.set('buildingBbl', effectiveBbl);
                    unitParams.set('buildingAddress', address);
                    if (bin) unitParams.set('bin', bin);
                    if (latitude) unitParams.set('lat', String(latitude));
                    if (longitude) unitParams.set('lon', String(longitude));
                    if (borough) unitParams.set('borough', borough);
                    window.location.href = `/results?${unitParams.toString()}`;
                  }}
                />
              )}

              {/* Mentioned Units Card - Shows whenever unit mentions exist (NOT gated by ownership) */}
              <UnitInsightsCard
                buildingBbl={effectiveBbl}
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
                hideWhenEmpty={true}
              />

              <Tabs ref={tabsRef} value={activeTab} onValueChange={handleTabChange} className="w-full">
                {/* Mobile: horizontally scrollable tab strip */}
                {isMobile ? (
                  <div className="bg-card border-b border-border">
                    <MobileTabsList>
                      <MobileTabsTrigger value="overview">Overview</MobileTabsTrigger>
                      <MobileTabsTrigger value="units">Units</MobileTabsTrigger>
                      <MobileTabsTrigger value="records">Records</MobileTabsTrigger>
                      <MobileTabsTrigger value="finance">Finance</MobileTabsTrigger>
                    </MobileTabsList>
                  </div>
                ) : (
                  /* Desktop/Tablet: standard tabs */
                  <div className="bg-card border-b border-border">
                    <TabsList className="justify-start bg-transparent rounded-none h-auto p-0">
                      <TabsTrigger 
                        value="overview" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                      >
                        Overview
                      </TabsTrigger>
                      <TabsTrigger 
                        value="units" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                      >
                        Units
                      </TabsTrigger>
                      <TabsTrigger 
                        value="records" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                      >
                        Records
                      </TabsTrigger>
                      <TabsTrigger 
                        value="finance" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent py-3 px-6"
                      >
                        Finance
                      </TabsTrigger>
                    </TabsList>
                  </div>
                )}

                <div className="mt-4 sm:mt-6">
                  <TabsContent value="overview" className="mt-0">
                    <OverviewTab
                      address={address}
                      borough={borough}
                      bbl={effectiveBbl}
                      bin={bin}
                      isCondo={isCondoBuilding && !isUnitLot}
                      isCoop={isCoop}
                      totalUnits={condoMeta.totalUnits || profile?.totalUnits}
                      recordCounts={recordCounts}
                      recordLoading={riskSnapshotLoading}
                      onTabChange={handleTabChange}
                    />
                  </TabsContent>
                  
                  <TabsContent value="units" className="mt-0" forceMount style={{ display: activeTab === 'units' ? 'block' : 'none' }}>
                    <UnitsTab
                      bbl={effectiveBbl}
                      buildingAddress={address}
                      borough={borough}
                      bin={bin}
                      isCoop={isCoop}
                      condoRoster={condoRoster}
                      rosterQueryBbl={condoRosterQueryBbl}
                    />
                  </TabsContent>
                  
                  <TabsContent value="records" className="mt-0">
                    <RecordsTab
                      bbl={queryBbl}
                      bin={bin}
                      lat={latitude}
                      lon={longitude}
                      address={address}
                      scope={scope}
                      isCoop={isCoop}
                      coopUnitContext={coopUnitContext}
                      recordCounts={recordCounts}
                      recordLoading={riskSnapshotLoading}
                      onClearUnitContext={handleClearUnitContext}
                    />
                  </TabsContent>
                  
                  <TabsContent value="finance" className="mt-0">
                    <FinanceTab bbl={effectiveBbl} address={address} />
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
