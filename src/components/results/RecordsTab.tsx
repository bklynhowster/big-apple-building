import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  FileText, 
  AlertTriangle, 
  Shield, 
  Hammer, 
  Phone, 
  Building2,
  ChevronDown,
  MapPin,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { ViolationsTab } from './ViolationsTab';
import { ECBTab } from './ECBTab';
import { SafetyTab } from './SafetyTab';
import { PermitsTab } from './PermitsTab';
import { HPDTab } from './HPDTab';
import { ThreeOneOneTab } from './ThreeOneOneTab';
import { RecordsDebugStrip } from './RecordsDebugStrip';
import { UnitMentionsHeader } from './UnitMentionsHeader';
import type { RecordCounts, LoadingStates } from './RiskSnapshotCard';

// Hooks for fetching records
import { useViolations } from '@/hooks/useViolations';
import { useECB } from '@/hooks/useECB';
import { usePermits } from '@/hooks/usePermits';
import { useHPDViolations, useHPDComplaints } from '@/hooks/useHPD';
import { filterRecordsByUnitMention } from '@/utils/unitMentionMatcher';

interface RecordsSectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  count: number;
  openCount?: number;
  loading?: boolean;
  defaultOpen?: boolean;
  hidden?: boolean;
  muted?: boolean;
  children: React.ReactNode;
}

function RecordsSection({ 
  id,
  title, 
  icon, 
  count, 
  openCount, 
  loading,
  defaultOpen = false,
  hidden = false,
  muted = false,
  children 
}: RecordsSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  if (hidden) return null;
  
  const hasOpen = (openCount || 0) > 0;
  
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card id={id} className={cn(
        "transition-colors",
        hasOpen && !muted && "border-warning/50",
        muted && "opacity-60"
      )}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {icon}
                {title}
                {loading ? (
                  <Badge variant="outline" className="ml-2">Loading...</Badge>
                ) : (
                  <>
                    <Badge variant="secondary" className="ml-2">{count}</Badge>
                    {hasOpen && !muted && (
                      <Badge variant="destructive" className="text-xs">
                        {openCount} open
                      </Badge>
                    )}
                  </>
                )}
              </CardTitle>
              <ChevronDown className={cn(
                "h-5 w-5 text-muted-foreground transition-transform",
                isOpen && "rotate-180"
              )} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

interface RecordsTabProps {
  bbl: string;
  bin?: string;
  lat?: number;
  lon?: number;
  address?: string;
  scope: 'unit' | 'building';
  isCondo?: boolean;
  isCoop?: boolean;
  coopUnitContext?: string | null;
  recordCounts: RecordCounts;
  recordLoading: LoadingStates;
  onClearUnitContext?: () => void;
  // Additional props for debug strip
  billingBbl?: string | null;
  unitBbl?: string | null;
  unitsCount?: number | null;
  activeTab?: string;
  // Unit mode props for mention filtering
  isUnitMode?: boolean;
  unitLabel?: string | null;
  unitMentionCount?: number;
}

export function RecordsTab({
  bbl,
  bin,
  lat,
  lon,
  address,
  scope,
  isCondo = false,
  isCoop = false,
  coopUnitContext,
  recordCounts,
  recordLoading,
  onClearUnitContext,
  billingBbl,
  unitBbl,
  unitsCount,
  activeTab = 'records',
  isUnitMode = false,
  unitLabel,
  unitMentionCount = 0,
}: RecordsTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Check if we're in unit mention filter mode
  const showUnitMentions = searchParams.get('showUnitMentions') === '1';
  const effectiveUnitLabel = showUnitMentions && isUnitMode && unitLabel ? unitLabel : null;
  
  // Fetch records for unit mention filtering
  // These hooks cache their results, so this won't cause extra API calls
  const dobViolations = useViolations(bbl);
  const ecbViolations = useECB(bbl);
  const permits = usePermits(bbl);
  const hpdViolations = useHPDViolations(bbl);
  const hpdComplaints = useHPDComplaints(bbl);
  
  // Trigger fetches if not already loaded
  useEffect(() => {
    if (bbl && bbl.length === 10) {
      if (!dobViolations.data && !dobViolations.loading) {
        dobViolations.fetchViolations(bbl);
      }
      if (!ecbViolations.data && !ecbViolations.loading) {
        ecbViolations.fetchECB(bbl);
      }
      if (!permits.data && !permits.loading) {
        permits.fetchPermits(bbl);
      }
    }
  }, [bbl]);
  
  // Compute filtered counts when in unit mention mode
  const filteredCounts = useMemo(() => {
    if (!effectiveUnitLabel) {
      return null; // Use original counts
    }
    
    const dobItems = dobViolations.data?.items || [];
    const ecbItems = ecbViolations.data?.items || [];
    const permitItems = permits.data?.items || [];
    const hpdViolationItems = hpdViolations.items || [];
    const hpdComplaintItems = hpdComplaints.items || [];
    
    const filteredDob = filterRecordsByUnitMention(dobItems, effectiveUnitLabel, 'dob-violation');
    const filteredEcb = filterRecordsByUnitMention(ecbItems, effectiveUnitLabel, 'ecb');
    const filteredPermits = filterRecordsByUnitMention(permitItems, effectiveUnitLabel, 'permit');
    const filteredHpdViolations = filterRecordsByUnitMention(hpdViolationItems, effectiveUnitLabel, 'hpd-violation');
    const filteredHpdComplaints = filterRecordsByUnitMention(hpdComplaintItems, effectiveUnitLabel, 'hpd-complaint');
    
    return {
      dobViolations: filteredDob.length,
      dobViolationsOpen: filteredDob.filter(r => r.status === 'open').length,
      ecbViolations: filteredEcb.length,
      ecbViolationsOpen: filteredEcb.filter(r => r.status === 'open').length,
      dobPermits: filteredPermits.length,
      hpdViolations: filteredHpdViolations.length,
      hpdViolationsOpen: filteredHpdViolations.filter(r => r.status === 'open').length,
      hpdComplaints: filteredHpdComplaints.length,
      hpdComplaintsOpen: filteredHpdComplaints.filter(r => r.status === 'open').length,
      // 311 is excluded in unit mention mode
      serviceRequests: 0,
      serviceRequestsOpen: 0,
      total: filteredDob.length + filteredEcb.length + filteredPermits.length + 
             filteredHpdViolations.length + filteredHpdComplaints.length,
    };
  }, [effectiveUnitLabel, dobViolations.data, ecbViolations.data, permits.data, hpdViolations.items, hpdComplaints.items]);
  
  // Use filtered or original counts
  const displayCounts = filteredCounts || recordCounts;
  const isFilteredMode = !!filteredCounts;
  
  // Loading state for filtered mode
  const isLoadingFiltered = isFilteredMode && (
    dobViolations.loading || 
    ecbViolations.loading || 
    permits.loading || 
    hpdViolations.loading || 
    hpdComplaints.loading
  );
  
  // Handler to clear the unit mention filter
  const handleClearUnitMentionFilter = () => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.delete('showUnitMentions');
      return p;
    }, { replace: true });
  };
  
  // Calculate which sections to show expanded by default
  const sectionsWithOpenItems = useMemo(() => {
    const sections: string[] = [];
    if ((displayCounts.dobViolationsOpen || 0) > 0) sections.push('violations');
    if ((displayCounts.ecbViolationsOpen || 0) > 0) sections.push('ecb');
    if ((displayCounts.hpdViolationsOpen || 0) > 0 || (displayCounts.hpdComplaintsOpen || 0) > 0) sections.push('hpd');
    if (!isFilteredMode && (recordCounts.serviceRequestsOpen || 0) > 0) sections.push('311');
    return sections;
  }, [displayCounts, isFilteredMode, recordCounts]);

  // Calculate total open for summary
  const totalOpen = useMemo(() => {
    return (displayCounts.dobViolationsOpen || 0) +
           (displayCounts.ecbViolationsOpen || 0) +
           (displayCounts.hpdViolationsOpen || 0) +
           (displayCounts.hpdComplaintsOpen || 0) +
           (isFilteredMode ? 0 : (recordCounts.serviceRequestsOpen || 0));
  }, [displayCounts, isFilteredMode, recordCounts]);
  
  // Total filtered count for header
  const totalFilteredCount = filteredCounts?.total ?? unitMentionCount;

  return (
    <div className="space-y-4">
      {/* Debug strip - only visible when ?debug=1 */}
      <RecordsDebugStrip
        viewMode={scope}
        activeTab={activeTab}
        buildingBbl={bbl}
        billingBbl={billingBbl}
        unitBbl={unitBbl}
        bin={bin}
        isCondo={isCondo}
        isCoop={isCoop}
        unitsCount={unitsCount}
        lat={lat}
        lon={lon}
        recordCounts={recordCounts}
        recordLoading={recordLoading}
      />
      
      {/* Unit Mentions Header - shown when filtered to unit mentions */}
      {showUnitMentions && isUnitMode && unitLabel && (
        <UnitMentionsHeader
          unitLabel={unitLabel}
          mentionCount={isLoadingFiltered ? -1 : totalFilteredCount}
          onViewAllRecords={handleClearUnitMentionFilter}
        />
      )}
      
      {/* Standard Summary header - hidden when in unit mention filter mode */}
      {!showUnitMentions && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Building Records</h2>
            <p className="text-sm text-muted-foreground">
              {totalOpen > 0 ? (
                <span className="text-warning">
                  {totalOpen} open issue{totalOpen !== 1 ? 's' : ''} across all categories
                </span>
              ) : (
                'All record categories'
              )}
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            BBL: {bbl}
          </Badge>
        </div>
      )}

      {/* Record sections */}
      <div className="space-y-3">
        {/* DOB Violations */}
        <RecordsSection
          id="dob-violations"
          title="DOB Violations"
          icon={<FileText className="h-4 w-4" />}
          count={isFilteredMode ? displayCounts.dobViolations : recordCounts.dobViolations}
          openCount={isFilteredMode ? displayCounts.dobViolationsOpen : recordCounts.dobViolationsOpen}
          loading={isFilteredMode ? dobViolations.loading : recordLoading.dobViolations}
          defaultOpen={sectionsWithOpenItems.includes('violations') || (isFilteredMode && displayCounts.dobViolations > 0)}
        >
          <ViolationsTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={effectiveUnitLabel || coopUnitContext}
            address={address}
            filterToUnitMentions={!!effectiveUnitLabel}
          />
        </RecordsSection>

        {/* ECB Violations */}
        <RecordsSection
          id="ecb-violations"
          title="ECB Violations"
          icon={<AlertTriangle className="h-4 w-4" />}
          count={isFilteredMode ? displayCounts.ecbViolations : recordCounts.ecbViolations}
          openCount={isFilteredMode ? displayCounts.ecbViolationsOpen : recordCounts.ecbViolationsOpen}
          loading={isFilteredMode ? ecbViolations.loading : recordLoading.ecbViolations}
          defaultOpen={sectionsWithOpenItems.includes('ecb') || (isFilteredMode && displayCounts.ecbViolations > 0)}
        >
          <ECBTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={effectiveUnitLabel || coopUnitContext}
            address={address}
            filterToUnitMentions={!!effectiveUnitLabel}
          />
        </RecordsSection>

        {/* Safety - typically no unit-specific data */}
        <RecordsSection
          id="safety-records"
          title="Safety & Compliance"
          icon={<Shield className="h-4 w-4" />}
          count={0}
          loading={false}
          defaultOpen={false}
          hidden={isFilteredMode} // Hide in unit mention mode - rarely has unit-specific data
        >
          <SafetyTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={effectiveUnitLabel || coopUnitContext}
            address={address}
            filterToUnitMentions={!!effectiveUnitLabel}
          />
        </RecordsSection>

        {/* Permits */}
        <RecordsSection
          id="dob-permits"
          title="DOB Permits"
          icon={<Hammer className="h-4 w-4" />}
          count={isFilteredMode ? displayCounts.dobPermits : recordCounts.dobPermits}
          loading={isFilteredMode ? permits.loading : recordLoading.dobPermits}
          defaultOpen={isFilteredMode && displayCounts.dobPermits > 0}
        >
          <PermitsTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={effectiveUnitLabel || coopUnitContext}
            address={address}
            filterToUnitMentions={!!effectiveUnitLabel}
          />
        </RecordsSection>

        {/* HPD */}
        <RecordsSection
          id="hpd-records"
          title="HPD Violations & Complaints"
          icon={<Building2 className="h-4 w-4" />}
          count={isFilteredMode 
            ? displayCounts.hpdViolations + displayCounts.hpdComplaints 
            : recordCounts.hpdViolations + recordCounts.hpdComplaints}
          openCount={isFilteredMode
            ? (displayCounts.hpdViolationsOpen || 0) + (displayCounts.hpdComplaintsOpen || 0)
            : (recordCounts.hpdViolationsOpen || 0) + (recordCounts.hpdComplaintsOpen || 0)}
          loading={isFilteredMode 
            ? hpdViolations.loading || hpdComplaints.loading 
            : recordLoading.hpdViolations || recordLoading.hpdComplaints}
          defaultOpen={sectionsWithOpenItems.includes('hpd') || (isFilteredMode && (displayCounts.hpdViolations + displayCounts.hpdComplaints) > 0)}
        >
          <div id="hpd-violations" />
          <div id="hpd-complaints" />
          <HPDTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={effectiveUnitLabel || coopUnitContext}
            onClearUnitContext={onClearUnitContext}
            address={address}
            filterToUnitMentions={!!effectiveUnitLabel}
          />
        </RecordsSection>

        {/* 311 - Hidden in unit mention mode (geographic, not unit-specific) */}
        {lat !== undefined && lon !== undefined && !isFilteredMode && (
          <RecordsSection
            id="service-requests"
            title="311 Service Requests"
            icon={<Phone className="h-4 w-4" />}
            count={recordCounts.serviceRequests}
            openCount={recordCounts.serviceRequestsOpen}
            loading={recordLoading.serviceRequests}
            defaultOpen={sectionsWithOpenItems.includes('311')}
          >
            <ThreeOneOneTab 
              lat={lat} 
              lon={lon} 
              scope={scope}
              isCoop={isCoop}
              coopUnitContext={coopUnitContext}
              onClearUnitContext={onClearUnitContext}
              address={address}
            />
          </RecordsSection>
        )}
        
        {/* 311 Nearby notice - shown in unit mention mode */}
        {lat !== undefined && lon !== undefined && isFilteredMode && (
          <Alert className="border-muted bg-muted/30">
            <MapPin className="h-4 w-4" />
            <AlertDescription className="text-sm text-muted-foreground">
              <strong>311 Service Requests</strong> are location-based and not filtered by unit. 
              <button 
                onClick={handleClearUnitMentionFilter}
                className="ml-1 text-primary hover:underline"
              >
                View all building records
              </button>
              {' '}to see nearby 311 requests.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
