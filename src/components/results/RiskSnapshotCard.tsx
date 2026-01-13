import { AlertTriangle, FileText, Shield, Building2, Phone, Hammer, DollarSign, ClipboardList, Loader2, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useCallback, useMemo, useState } from 'react';

// Mapping of chip keys to their anchor IDs and tab names
const CHIP_CONFIG = {
  dobViolations: { anchorId: 'dob-violations', tab: 'violations', label: 'DOB Violations' },
  ecbViolations: { anchorId: 'ecb-violations', tab: 'ecb', label: 'ECB Violations' },
  hpdViolations: { anchorId: 'hpd-violations', tab: 'hpd', label: 'HPD Violations' },
  hpdComplaints: { anchorId: 'hpd-complaints', tab: 'hpd', label: 'HPD Complaints' },
  serviceRequests: { anchorId: 'service-requests', tab: '311', label: '311 Requests' },
  dobPermits: { anchorId: 'dob-permits', tab: 'permits', label: 'DOB Permits' },
  salesRecords: { anchorId: 'sales-records', tab: 'all', label: 'Sales Records' },
  dobFilingsUnits: { anchorId: 'dob-filings', tab: 'all', label: 'DOB Filings Units' },
} as const;

type ChipKey = keyof typeof CHIP_CONFIG;

interface RiskChipProps {
  label: string;
  count: number;
  loading?: boolean;
  isViolation?: boolean;
  icon: React.ReactNode;
  openCount?: number;
  anchorId: string;
  onClick: () => void;
}

function RiskChip({ label, count, loading, isViolation, icon, openCount, anchorId, onClick }: RiskChipProps) {
  const [isHovered, setIsHovered] = useState(false);
  const hasRecords = count > 0;
  const showWarning = isViolation && hasRecords;
  
  return (
    <a 
      href={`#${anchorId}`}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "flex flex-col p-3 rounded-lg border transition-all cursor-pointer group",
        "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2",
        showWarning 
          ? "border-warning/50 bg-warning/5 hover:border-warning hover:bg-warning/10" 
          : "border-border bg-card hover:border-primary/50 hover:bg-accent/50"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-muted-foreground transition-colors",
            showWarning && "text-warning",
            isHovered && !showWarning && "text-primary"
          )}>
            {icon}
          </span>
          {showWarning && (
            <AlertTriangle className="h-3 w-3 text-warning" />
          )}
        </div>
        <ChevronRight className={cn(
          "h-3 w-3 text-muted-foreground/50 transition-all",
          isHovered && "text-primary translate-x-0.5"
        )} />
      </div>
      
      <div className="flex items-baseline gap-1">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <span className={cn(
              "text-2xl font-semibold tabular-nums",
              showWarning ? "text-warning" : "text-foreground"
            )}>
              {count}
            </span>
            {openCount !== undefined && openCount > 0 && (
              <span className="text-xs text-muted-foreground ml-1">
                ({openCount} open)
              </span>
            )}
          </>
        )}
      </div>
      
      <span className="text-xs text-muted-foreground mt-0.5">
        {label}
      </span>
      
      <span className="text-[10px] text-muted-foreground/70">
        records found
      </span>
    </a>
  );
}

export interface RecordCounts {
  dobViolations: number;
  dobViolationsOpen?: number;
  ecbViolations: number;
  ecbViolationsOpen?: number;
  hpdViolations: number;
  hpdViolationsOpen?: number;
  hpdComplaints: number;
  hpdComplaintsOpen?: number;
  serviceRequests: number;
  serviceRequestsOpen?: number;
  dobPermits: number;
  salesRecords: number;
  dobFilingsUnits: number;
}

export interface LoadingStates {
  dobViolations?: boolean;
  ecbViolations?: boolean;
  hpdViolations?: boolean;
  hpdComplaints?: boolean;
  serviceRequests?: boolean;
  dobPermits?: boolean;
  salesRecords?: boolean;
  dobFilingsUnits?: boolean;
}

interface RiskSnapshotCardProps {
  counts: RecordCounts;
  loading?: LoadingStates;
  onNavigateToSection?: (tab: string, anchorId: string) => void;
}

export function RiskSnapshotCard({ counts, loading = {}, onNavigateToSection }: RiskSnapshotCardProps) {
  // Check for reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const scrollToSection = useCallback((anchorId: string, tab: string) => {
    // Update URL hash
    const newUrl = `${window.location.pathname}${window.location.search}#${anchorId}`;
    window.history.pushState(null, '', newUrl);
    
    // Notify parent to switch tab first
    if (onNavigateToSection) {
      onNavigateToSection(tab, anchorId);
    }
    
    // Scroll after a short delay to allow tab switch
    setTimeout(() => {
      const element = document.getElementById(anchorId);
      if (element) {
        element.scrollIntoView({ 
          behavior: prefersReducedMotion ? 'auto' : 'smooth', 
          block: 'start' 
        });
      }
    }, 100);
  }, [onNavigateToSection, prefersReducedMotion]);

  const handleChipClick = useCallback((key: ChipKey) => {
    const config = CHIP_CONFIG[key];
    scrollToSection(config.anchorId, config.tab);
  }, [scrollToSection]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          Risk Snapshot
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <RiskChip
            label="DOB Violations"
            count={counts.dobViolations}
            openCount={counts.dobViolationsOpen}
            loading={loading.dobViolations}
            isViolation
            icon={<FileText className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.dobViolations.anchorId}
            onClick={() => handleChipClick('dobViolations')}
          />
          
          <RiskChip
            label="ECB Violations"
            count={counts.ecbViolations}
            openCount={counts.ecbViolationsOpen}
            loading={loading.ecbViolations}
            isViolation
            icon={<FileText className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.ecbViolations.anchorId}
            onClick={() => handleChipClick('ecbViolations')}
          />
          
          <RiskChip
            label="HPD Violations"
            count={counts.hpdViolations}
            openCount={counts.hpdViolationsOpen}
            loading={loading.hpdViolations}
            isViolation
            icon={<Building2 className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.hpdViolations.anchorId}
            onClick={() => handleChipClick('hpdViolations')}
          />
          
          <RiskChip
            label="HPD Complaints"
            count={counts.hpdComplaints}
            openCount={counts.hpdComplaintsOpen}
            loading={loading.hpdComplaints}
            icon={<ClipboardList className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.hpdComplaints.anchorId}
            onClick={() => handleChipClick('hpdComplaints')}
          />
          
          <RiskChip
            label="311 Requests"
            count={counts.serviceRequests}
            openCount={counts.serviceRequestsOpen}
            loading={loading.serviceRequests}
            icon={<Phone className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.serviceRequests.anchorId}
            onClick={() => handleChipClick('serviceRequests')}
          />
          
          <RiskChip
            label="DOB Permits"
            count={counts.dobPermits}
            loading={loading.dobPermits}
            icon={<Hammer className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.dobPermits.anchorId}
            onClick={() => handleChipClick('dobPermits')}
          />
          
          <RiskChip
            label="Sales Records"
            count={counts.salesRecords}
            loading={loading.salesRecords}
            icon={<DollarSign className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.salesRecords.anchorId}
            onClick={() => handleChipClick('salesRecords')}
          />
          
          <RiskChip
            label="DOB Filings Units"
            count={counts.dobFilingsUnits}
            loading={loading.dobFilingsUnits}
            icon={<ClipboardList className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.dobFilingsUnits.anchorId}
            onClick={() => handleChipClick('dobFilingsUnits')}
          />
        </div>
        
        <p className="text-[10px] text-muted-foreground/70 mt-3">
          Building-level summary from NYC Open Data. Click any card to view details.
        </p>
      </CardContent>
    </Card>
  );
}