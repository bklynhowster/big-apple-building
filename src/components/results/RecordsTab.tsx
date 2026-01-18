import { useState, useMemo, useCallback } from 'react';
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
import { MentionedRecordsList } from './MentionedRecordsList';
import { UnitMentionsDiagnosticMatrix } from './UnitMentionsDiagnosticMatrix';
import type { RecordCounts, LoadingStates } from './RiskSnapshotCard';
import type { CombinedUnitStats } from '@/hooks/useUnitMentions';

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
  /** Source-of-truth inferred unit mentions for the current unit (from useUnitMentions) */
  unitMentions?: CombinedUnitStats | null;
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
  unitMentions = null,
}: RecordsTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Check if we're in unit mention filter mode
  const showUnitMentions = searchParams.get('showUnitMentions') === '1';
  const isUnitMentionsMode = showUnitMentions && isUnitMode && !!unitLabel;

  // Handler to clear the unit mention filter
  const handleClearUnitMentionFilter = () => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('showUnitMentions');
        return p;
      },
      { replace: true }
    );
  };

  // Debug mode
  const showDebug = searchParams.get('debug') === '1';

  // =========================
  // Unit Mentions mode (source-of-truth from useUnitMentions)
  // =========================

  // Compute total count directly from unitMentions (matches Results.tsx calculation)
  const totalMentioned = useMemo(() => {
    if (!unitMentions) return 0;
    const hpdCount = unitMentions.sourceRefs.filter((r) => r.type === 'hpd').length;
    return unitMentions.violationRefs.length + unitMentions.permitRefs.length + hpdCount;
  }, [unitMentions]);

  // Callback for scrolling to a section
  const handleScrollToSection = useCallback((sectionId: string, _recordId?: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // =========================
  // UNIT MENTIONS MODE RENDER
  // =========================
  if (isUnitMentionsMode) {
    return (
      <div className="space-y-4">
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

        <UnitMentionsHeader
          unitLabel={unitLabel!}
          mentionCount={totalMentioned}
          onViewAllRecords={handleClearUnitMentionFilter}
        />

        {/* Debug: Diagnostic Matrix (only when ?debug=1) */}
        {showDebug && (
          <UnitMentionsDiagnosticMatrix
            unitBbl={unitBbl}
            buildingBbl={bbl}
            bin={bin}
            recordCounts={recordCounts}
          />
        )}

        {/* Mentioned Records List - the primary drill-down view */}
        {unitMentions ? (
          <MentionedRecordsList
            unitLabel={unitLabel!}
            unitMentions={unitMentions}
            onScrollToSection={handleScrollToSection}
          />
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Loading unit mentions...
              </p>
            </CardContent>
          </Card>
        )}

        {/* 311 is intentionally excluded from Unit Mentions mode */}
        {lat !== undefined && lon !== undefined && (
          <Alert className="border-muted bg-muted/30">
            <MapPin className="h-4 w-4" />
            <AlertDescription className="text-sm text-muted-foreground">
              <strong>311 Service Requests</strong> are location-based and not shown in unit mentions.
              <button onClick={handleClearUnitMentionFilter} className="ml-1 text-primary hover:underline">
                View all building records
              </button>
              {' '}to see nearby 311 requests.
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  // =========================
  // Standard Records view (building / unit context)
  // =========================

  // Calculate which sections to show expanded by default
  const sectionsWithOpenItems = useMemo(() => {
    const sections: string[] = [];
    if ((recordCounts.dobViolationsOpen || 0) > 0) sections.push('violations');
    if ((recordCounts.ecbViolationsOpen || 0) > 0) sections.push('ecb');
    if ((recordCounts.hpdViolationsOpen || 0) > 0 || (recordCounts.hpdComplaintsOpen || 0) > 0) sections.push('hpd');
    if ((recordCounts.serviceRequestsOpen || 0) > 0) sections.push('311');
    return sections;
  }, [recordCounts]);

  // Calculate total open for summary
  const totalOpen = useMemo(() => {
    return (
      (recordCounts.dobViolationsOpen || 0) +
      (recordCounts.ecbViolationsOpen || 0) +
      (recordCounts.hpdViolationsOpen || 0) +
      (recordCounts.hpdComplaintsOpen || 0) +
      (recordCounts.serviceRequestsOpen || 0)
    );
  }, [recordCounts]);

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
      
      {/* Standard Summary header */}
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

      {/* Record sections */}
      <div className="space-y-3">
        {/* DOB Violations */}
        <RecordsSection
          id="dob-violations"
          title="DOB Violations"
          icon={<FileText className="h-4 w-4" />}
          count={recordCounts.dobViolations}
          openCount={recordCounts.dobViolationsOpen}
          loading={recordLoading.dobViolations}
          defaultOpen={sectionsWithOpenItems.includes('violations')}
        >
          <ViolationsTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={coopUnitContext}
            address={address}
          />
        </RecordsSection>

        {/* ECB Violations */}
        <RecordsSection
          id="ecb-violations"
          title="ECB Violations"
          icon={<AlertTriangle className="h-4 w-4" />}
          count={recordCounts.ecbViolations}
          openCount={recordCounts.ecbViolationsOpen}
          loading={recordLoading.ecbViolations}
          defaultOpen={sectionsWithOpenItems.includes('ecb')}
        >
          <ECBTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={coopUnitContext}
            address={address}
          />
        </RecordsSection>

        {/* Safety */}
        <RecordsSection
          id="safety-records"
          title="Safety & Compliance"
          icon={<Shield className="h-4 w-4" />}
          count={0}
          loading={false}
          defaultOpen={false}
        >
          <SafetyTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={coopUnitContext}
            address={address}
          />
        </RecordsSection>

        {/* Permits */}
        <RecordsSection
          id="dob-permits"
          title="DOB Permits"
          icon={<Hammer className="h-4 w-4" />}
          count={recordCounts.dobPermits}
          loading={recordLoading.dobPermits}
          defaultOpen={false}
        >
          <PermitsTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={coopUnitContext}
            address={address}
          />
        </RecordsSection>

        {/* HPD */}
        <RecordsSection
          id="hpd-records"
          title="HPD Violations & Complaints"
          icon={<Building2 className="h-4 w-4" />}
          count={recordCounts.hpdViolations + recordCounts.hpdComplaints}
          openCount={(recordCounts.hpdViolationsOpen || 0) + (recordCounts.hpdComplaintsOpen || 0)}
          loading={recordLoading.hpdViolations || recordLoading.hpdComplaints}
          defaultOpen={sectionsWithOpenItems.includes('hpd')}
        >
          <div id="hpd-violations" />
          <div id="hpd-complaints" />
          <HPDTab 
            bbl={bbl} 
            bin={bin} 
            scope={scope} 
            isCoop={isCoop} 
            coopUnitContext={coopUnitContext}
            onClearUnitContext={onClearUnitContext}
            address={address}
          />
        </RecordsSection>

        {/* 311 */}
        {lat !== undefined && lon !== undefined && (
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
      </div>
    </div>
  );
}
