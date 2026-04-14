/**
 * SingleScrollLayout — Redesign v2
 *
 * Replaces the tabbed layout with a single continuous scroll page.
 * All content is visible: Health Strip → Unit Roster → Building Records → Finance.
 * No tabs, no accordions. Sections auto-expand. Click health chips to scroll.
 *
 * Feature-flagged via ?v=2 URL param.
 */

import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AlertTriangle, DollarSign, ArrowLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { BuildingHeader } from './BuildingHeader';
import { RiskSnapshotCard, type RecordCounts, type LoadingStates, type RecordArrays, type NavigationInfo } from './RiskSnapshotCard';
import { UnitInsightsCard } from './UnitInsightsCard';
import { PropertyProfileCard } from './PropertyProfileCard';
import { CondoUnitsPreview } from './CondoUnitsPreview';

import { ViolationsTab } from './ViolationsTab';
import { ECBTab } from './ECBTab';
import { HPDTab } from './HPDTab';
import { PermitsTab } from './PermitsTab';
import { ThreeOneOneTab } from './ThreeOneOneTab';
import { TaxesPanel, usePropertyTaxes } from '@/features/taxes';
import { FinanceTab } from './FinanceTab';
import type { CondoMeta } from './UnitsTab';
import type { HPDViolationRecord, HPDComplaintRecord } from '@/hooks/useHPD';
import type { ServiceRequestRecord } from '@/hooks/use311';
import type { ViolationRecord } from '@/hooks/useViolations';
import type { ECBRecord } from '@/hooks/useECB';
import type { PermitRecord } from '@/hooks/usePermits';
import type { UnitRosterEntry } from '@/hooks/useCoopUnitRoster';
import type { UnitFromFilings, JobFilingRecord } from '@/hooks/useDobJobFilings';
import type { PropertyTaxResult } from '@/features/taxes/types';
import type { LandmarkStatus } from '@/hooks/useLandmarkStatus';
import type { AcrisUnit } from '@/hooks/useAcrisUnitRoster';


// Scroll smoothly to an element by ID
function scrollToId(id: string) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 100);
}

interface SingleScrollLayoutProps {
  // Building identity
  address: string;
  borough: string;
  bbl: string;
  effectiveBbl: string;
  bin: string;
  latitude?: number;
  longitude?: number;

  // Property classification
  isCoop: boolean;
  isCondoBuilding: boolean;
  isUnitLot: boolean;
  profileLoading: boolean;
  totalUnits?: number | null;
  condoMeta: CondoMeta;

  // Property profile
  landmarkStatus: LandmarkStatus;
  onOwnershipOverrideChange: (effective: boolean) => void;

  // Record counts for health strip
  recordCounts: RecordCounts;
  riskSnapshotLoading: LoadingStates;
  riskSnapshotRecords: RecordArrays;

  // Record data for Unit Insights
  hpdViolations: HPDViolationRecord[];
  hpdComplaints: HPDComplaintRecord[];
  serviceRequests: ServiceRequestRecord[];
  salesUnits: UnitRosterEntry[];
  dobFilingsUnits: UnitFromFilings[];
  dobFilings: JobFilingRecord[];
  dobViolations: ViolationRecord[];
  ecbViolations: ECBRecord[];
  dobPermits: PermitRecord[];

  // Loading states for unit insights
  loadingStates: {
    filings: boolean;
    permits: boolean;
    hpd: boolean;
    threeOneOne: boolean;
    violations: boolean;
    ecb: boolean;
  };

  // Co-op unit context
  coopUnitContext: string | null;
  onCoopUnitContextChange: (unit: string | null) => void;
  rosterError?: string | null;
  salesWarning?: string | null;
  dobNowUrl?: string | null;
  fallbackMode?: boolean;

  // Condo roster
  condoRoster: any; // UseCondoUnitsReturn type
  condoRosterQueryBbl: string | null;

  // Tax data
  taxData?: PropertyTaxResult | null;
  taxLoading?: boolean;

  // ACRIS sales data
  acrisUnits?: AcrisUnit[];
  acrisLoading?: boolean;

  // Navigation
  navigate: ReturnType<typeof useNavigate>;

  // Query BBL (for records fetching based on scope)
  queryBbl: string;
  billingBbl: string | null;
  buildingBblParam: string;
  buildingAddressParam: string;
  scope: 'building' | 'unit';
}

// Arrears badge for the health strip
function ArrearsChip({
  arrears,
  loading,
  onClick
}: {
  arrears: number | null;
  loading: boolean;
  onClick: () => void;
}) {
  if (loading) {
    return (
      <button
        onClick={onClick}
        className="flex flex-col items-center px-3 py-2 rounded-lg bg-muted min-w-[90px] animate-pulse"
      >
        <span className="text-lg font-bold text-muted-foreground">...</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Tax Arrears</span>
      </button>
    );
  }

  const hasArrears = arrears != null && arrears > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center px-3 py-2 rounded-lg min-w-[90px] transition-all border cursor-pointer",
        hasArrears
          ? "bg-red-50 border-red-200 hover:border-red-400 dark:bg-red-950 dark:border-red-800"
          : "bg-green-50 border-green-200 hover:border-green-400 dark:bg-green-950 dark:border-green-800"
      )}
    >
      <span className={cn(
        "text-lg font-bold",
        hasArrears ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
      )}>
        {hasArrears ? `$${arrears.toLocaleString()}` : '$0'}
      </span>
      <span className={cn(
        "text-[10px] uppercase tracking-wider font-semibold",
        hasArrears ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300"
      )}>
        Tax Arrears
      </span>
    </button>
  );
}

// Section wrapper with anchor ID — collapsible, default closed
function ScrollSection({
  id,
  title,
  count,
  openCount,
  statusSummary,
  defaultOpen = false,
  forceOpen,
  loading,
  children
}: {
  id: string;
  title: string;
  count?: number;
  openCount?: number;
  statusSummary?: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const hasOpen = (openCount ?? 0) > 0;

  // Allow external force-open (e.g. from risk chip click)
  useEffect(() => {
    if (forceOpen) setIsOpen(true);
  }, [forceOpen]);

  return (
    <div id={id} className="scroll-mt-20">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-3 px-4 rounded-lg bg-card border hover:bg-accent/50 transition-colors cursor-pointer group"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform" />
          )}
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-xs text-muted-foreground animate-pulse">Loading...</span>
          ) : count !== undefined && count > 0 ? (
            <span className="text-sm text-muted-foreground">
              {count} record{count !== 1 ? 's' : ''}
              {hasOpen ? (
                <span className="text-red-600 dark:text-red-400 font-semibold ml-2">
                  {openCount} open
                </span>
              ) : statusSummary ? (
                <span className="text-green-600 dark:text-green-400 font-medium ml-2">
                  {statusSummary}
                </span>
              ) : null}
            </span>
          ) : count === 0 ? (
            <span className="text-xs text-muted-foreground">None</span>
          ) : null}
        </div>
      </button>
      {isOpen && (
        <div className="mt-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function SingleScrollLayout(props: SingleScrollLayoutProps) {
  const {
    address,
    borough,
    bbl,
    effectiveBbl,
    bin,
    latitude,
    longitude,
    isCoop,
    isCondoBuilding,
    isUnitLot,
    profileLoading,
    totalUnits,
    condoMeta,
    landmarkStatus,
    onOwnershipOverrideChange,
    recordCounts,
    riskSnapshotLoading,
    riskSnapshotRecords,
    hpdViolations,
    hpdComplaints,
    serviceRequests,
    salesUnits,
    dobFilingsUnits,
    dobFilings,
    dobViolations,
    ecbViolations,
    dobPermits,
    loadingStates,
    coopUnitContext,
    onCoopUnitContextChange,
    rosterError,
    salesWarning,
    dobNowUrl,
    fallbackMode,
    condoRoster,
    condoRosterQueryBbl,
    taxData,
    taxLoading,
    acrisUnits,
    acrisLoading,
    navigate,
    queryBbl,
    billingBbl,
    buildingBblParam,
    buildingAddressParam,
    scope,
  } = props;

  const [searchParams] = useSearchParams();

  // Track which section should be force-expanded (from risk chip click)
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Handle health chip click — expand section + scroll to it
  const handleHealthChipNav = useCallback((info: NavigationInfo) => {
    const targetId = `scroll-${info.anchorId}`;
    setExpandedSection(targetId);
    // Small delay to let React render the expanded content before scrolling
    setTimeout(() => scrollToId(targetId), 150);
  }, []);

  // Handle condo unit selection
  const handleCondoUnitSelect = useCallback((unitBbl: string, unitLabel?: string | null) => {
    const unitParams = new URLSearchParams();
    unitParams.set('bbl', unitBbl);
    unitParams.set('address', address);
    unitParams.set('buildingBbl', effectiveBbl);
    unitParams.set('buildingAddress', address);
    unitParams.set('v', '2'); // Keep v2 layout
    if (unitLabel) unitParams.set('unitLabel', unitLabel);
    if (bin) unitParams.set('bin', bin);
    if (latitude) unitParams.set('lat', String(latitude));
    if (longitude) unitParams.set('lon', String(longitude));
    if (borough) unitParams.set('borough', borough);
    navigate(`/results?${unitParams.toString()}`);
  }, [address, effectiveBbl, bin, latitude, longitude, borough, navigate]);

  // Determine property type label
  const propertyTypeLabel = isCoop ? 'Co-op' : isCondoBuilding ? 'Condo' : 'Building';

  return (
    <div className="space-y-6">
      {/* 1. Building Header */}
      <BuildingHeader
        address={address}
        borough={borough}
        bbl={effectiveBbl}
        bin={bin}
        isCondo={isCondoBuilding}
        isCoop={isCoop}
        totalUnits={condoMeta.totalUnits || totalUnits}
        loading={profileLoading}
      />

      {/* 2. Risk Snapshot — FIRST, always on top */}
      <RiskSnapshotCard
        counts={recordCounts}
        loading={riskSnapshotLoading}
        records={riskSnapshotRecords}
        onNavigateToSection={handleHealthChipNav}
      />

      {/* 2b. Tax Arrears chip */}
      <div className="flex items-center gap-3 flex-wrap">
        <ArrearsChip
          arrears={(() => {
            const raw = taxData?.arrears ?? null;
            if (raw != null && raw > 0) return raw;
            if (taxData?.payment_status === 'unpaid' && taxData?.latest_due_date) {
              const due = new Date(taxData.latest_due_date);
              if (due < new Date() && taxData.latest_period_balance != null && taxData.latest_period_balance > 0) {
                return taxData.latest_period_balance;
              }
            }
            return raw;
          })()}
          loading={taxLoading ?? false}
          onClick={() => scrollToId('scroll-finance')}
        />
      </div>

      {/* 2c. Condo Units — compact drill-down */}
      {!isCoop && !isUnitLot && isCondoBuilding && (
        <CondoUnitsPreview
          searchBbl={effectiveBbl}
          rosterQueryBbl={condoRosterQueryBbl}
          condoData={condoRoster.data}
          loading={condoRoster.loading}
          error={condoRoster.error}
          isCoop={isCoop}
          onViewAllUnits={() => scrollToId('scroll-units')}
          onSelectUnit={handleCondoUnitSelect}
        />
      )}

      {/* 3. Property Profile */}
      <PropertyProfileCard
        bbl={effectiveBbl}
        parentAddress={address}
        landmarkStatus={landmarkStatus}
        lat={latitude}
        lon={longitude}
        onOwnershipOverrideChange={onOwnershipOverrideChange}
      />

      {/* Map is now inside PropertyProfileCard via LocationMap */}

      {/* 4. Unit Insights — shows which units are mentioned in violations (skip for condos — handled by CondoUnitsPreview) */}
      <div id="scroll-units-insights" className="scroll-mt-20" />
      {!isCondoBuilding && <UnitInsightsCard
        buildingBbl={effectiveBbl}
        bin={bin}
        hpdViolations={hpdViolations}
        hpdComplaints={hpdComplaints}
        serviceRequests={serviceRequests}
        salesUnits={salesUnits}
        dobFilingsUnits={dobFilingsUnits}
        dobFilings={dobFilings}
        dobViolations={dobViolations}
        ecbViolations={ecbViolations}
        dobPermits={dobPermits}
        selectedUnit={coopUnitContext}
        onUnitSelect={onCoopUnitContextChange}
        onClearUnitFilter={() => onCoopUnitContextChange(null)}
        loadingStates={loadingStates}
        rosterError={rosterError}
        salesWarning={salesWarning}
        dobNowUrl={dobNowUrl}
        fallbackMode={fallbackMode}
        hideWhenEmpty={true}
        onNavigateToRecord={(sectionKey) => {
          const targetId = `scroll-${sectionKey}`;
          setExpandedSection(targetId);
          setTimeout(() => scrollToId(targetId), 150);
        }}
      />}

      {/* 5. Building Records — collapsible sections, default closed */}
      <div className="space-y-2">

        {/* ECB Violations */}
        <ScrollSection
          id="scroll-ecb"
          title="ECB Violations"
          count={recordCounts.ecbViolations}
          openCount={recordCounts.ecbViolationsOpen}
          statusSummary={(recordCounts.ecbViolationsOpen ?? 0) === 0 && recordCounts.ecbViolations > 0 ? 'all resolved' : undefined}
          forceOpen={expandedSection === 'scroll-ecb'}
          loading={loadingStates.ecb}
        >
          <Card>
            <CardContent className="p-0">
              <ECBTab
                bbl={queryBbl}
                bin={bin}
                scope={scope}
                isCoop={isCoop}
                coopUnitContext={coopUnitContext}
                address={address}
              />
            </CardContent>
          </Card>
        </ScrollSection>

        {/* DOB Violations */}
        <ScrollSection
          id="scroll-dob"
          title="DOB Violations"
          count={recordCounts.dobViolations}
          openCount={recordCounts.dobViolationsOpen}
          statusSummary={(recordCounts.dobViolationsOpen ?? 0) === 0 && recordCounts.dobViolations > 0 ? 'all resolved' : undefined}
          forceOpen={expandedSection === 'scroll-dob'}
          loading={loadingStates.violations}
        >
          <Card>
            <CardContent className="p-0">
              <ViolationsTab
                bbl={queryBbl}
                bin={bin}
                scope={scope}
                isCoop={isCoop}
                coopUnitContext={coopUnitContext}
                address={address}
              />
            </CardContent>
          </Card>
        </ScrollSection>

        {/* HPD Violations & Complaints */}
        <ScrollSection
          id="scroll-hpd"
          title="HPD Violations & Complaints"
          count={recordCounts.hpdViolations + recordCounts.hpdComplaints}
          openCount={(recordCounts.hpdViolationsOpen ?? 0) + (recordCounts.hpdComplaintsOpen ?? 0)}
          forceOpen={expandedSection === 'scroll-hpd'}
          loading={loadingStates.hpd}
        >
          <Card>
            <CardContent className="p-0">
              <HPDTab
                bbl={queryBbl}
                bin={bin}
                lat={latitude}
                lon={longitude}
                scope={scope}
                isCoop={isCoop}
                coopUnitContext={coopUnitContext}
                address={address}
              />
            </CardContent>
          </Card>
        </ScrollSection>

        {/* DOB Permits */}
        <ScrollSection
          id="scroll-permits"
          title="DOB Permits"
          count={recordCounts.dobPermits}
          statusSummary={(() => {
            const now = new Date();
            const expired = dobPermits.filter(p => p.expirationDate && new Date(p.expirationDate) < now && p.status !== 'closed').length;
            const active = dobPermits.filter(p => p.status === 'open' && !(p.expirationDate && new Date(p.expirationDate) < now)).length;
            const closed = dobPermits.filter(p => p.status === 'closed').length;
            const parts: string[] = [];
            if (expired > 0) parts.push(`${expired} expired`);
            if (active > 0) parts.push(`${active} active`);
            if (closed > 0) parts.push(`${closed} closed`);
            return parts.length > 0 ? parts.join(' · ') : undefined;
          })()}
          forceOpen={expandedSection === 'scroll-permits'}
          loading={loadingStates.permits}
        >
          <Card>
            <CardContent className="p-0">
              <PermitsTab
                bbl={queryBbl}
                bin={bin}
                scope={scope}
                isCoop={isCoop}
                coopUnitContext={coopUnitContext}
                address={address}
              />
            </CardContent>
          </Card>
        </ScrollSection>

        {/* 311 Service Requests */}
        <ScrollSection
          id="scroll-311"
          title="311 Service Requests"
          count={recordCounts.serviceRequests}
          openCount={recordCounts.serviceRequestsOpen}
          forceOpen={expandedSection === 'scroll-311'}
          loading={loadingStates.threeOneOne}
        >
          <Card>
            <CardContent className="p-0">
              <ThreeOneOneTab
                lat={latitude}
                lon={longitude}
                scope={scope}
                isCoop={isCoop}
                coopUnitContext={coopUnitContext}
                address={address}
              />
            </CardContent>
          </Card>
        </ScrollSection>

        {/* Sales / ACRIS Transactions */}
        <ScrollSection
          id="scroll-sales"
          title="Sales & Transactions (ACRIS)"
          count={recordCounts.salesRecords}
          forceOpen={expandedSection === 'scroll-sales'}
          loading={acrisLoading}
        >
          <Card>
            <CardContent className="p-0">
              {acrisLoading ? (
                <div className="p-6 text-center text-muted-foreground text-sm">Loading ACRIS data...</div>
              ) : !acrisUnits || acrisUnits.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  No ACRIS transaction records found for this property.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {acrisUnits.map((unit) => (
                    <div key={unit.unit} className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm">Unit {unit.unit}</span>
                        <span className="text-xs text-muted-foreground">
                          {unit.transactionCount} transaction{unit.transactionCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      {unit.lastSaleAmount && (
                        <div className="text-xs text-muted-foreground mb-1">
                          Last sale: <span className="font-semibold text-foreground">
                            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(unit.lastSaleAmount)}
                          </span>
                          {unit.lastTransactionDate && (
                            <> on {new Date(unit.lastTransactionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                          )}
                        </div>
                      )}
                      {unit.lastBuyer && (
                        <div className="text-xs text-muted-foreground">
                          Buyer: <span className="text-foreground">{unit.lastBuyer}</span>
                        </div>
                      )}
                      {unit.transactions.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {unit.transactions.slice(0, 5).map((tx, i) => (
                            <div key={tx.documentId || i} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono w-[80px] shrink-0">
                                {tx.recordedDate || tx.documentDate
                                  ? new Date(tx.recordedDate || tx.documentDate!).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                                  : '—'}
                              </span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {tx.docType || 'Unknown'}
                              </Badge>
                              {tx.amount != null && tx.amount > 0 && (
                                <span className="font-semibold text-foreground">
                                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(tx.amount)}
                                </span>
                              )}
                            </div>
                          ))}
                          {unit.transactions.length > 5 && (
                            <div className="text-xs text-muted-foreground/60">+ {unit.transactions.length - 5} more</div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </ScrollSection>
      </div>

      {/* 6. Finance & Taxes — collapsible */}
        <ScrollSection
          id="scroll-finance"
          title="Finance & Taxes"
          forceOpen={expandedSection === 'scroll-finance'}
          loading={taxLoading}
        >
          {/* Tax Arrears highlight card */}
          {taxData && (() => {
            const raw = taxData.arrears;
            if (raw != null && raw > 0) return true;
            if (taxData.payment_status === 'unpaid' && taxData.latest_due_date) {
              const due = new Date(taxData.latest_due_date);
              if (due < new Date() && taxData.latest_period_balance != null && taxData.latest_period_balance > 0) return true;
            }
            return false;
          })() && (
            <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800 mb-4">
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4" />
                  Tax Arrears Outstanding
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {'$'}{((taxData.arrears != null && taxData.arrears > 0)
                    ? taxData.arrears
                    : (taxData.latest_period_balance ?? 0)
                  ).toLocaleString()}
                </p>
                {taxData.arrears_note && (
                  <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">
                    {taxData.arrears_note}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <TaxesPanel
            context={isUnitLot ? 'unit' : 'building'}
            viewBbl={bbl}
            buildingBbl={buildingBblParam || billingBbl || undefined}
            address={address}
            isCondo={false /* always show taxes in v2 layout */}
          />
        </ScrollSection>
    </div>
  );
}
