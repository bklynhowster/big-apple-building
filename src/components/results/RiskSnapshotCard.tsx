import { AlertTriangle, FileText, Shield, Building2, Phone, Hammer, DollarSign, ClipboardList, Loader2, ChevronRight, Circle, TrendingUp, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useCallback, useMemo, useState } from 'react';

// Dataset scope type
export type DatasetScope = 'building' | 'unit';

// Mapping of chip keys to their anchor IDs, tab names, and data scope
const CHIP_CONFIG = {
  dobViolations: { anchorId: 'dob-violations', tab: 'violations', label: 'DOB Violations', scope: 'building' as DatasetScope },
  ecbViolations: { anchorId: 'ecb-violations', tab: 'ecb', label: 'ECB Violations', scope: 'building' as DatasetScope },
  hpdViolations: { anchorId: 'hpd-violations', tab: 'hpd', label: 'HPD Violations', scope: 'building' as DatasetScope },
  hpdComplaints: { anchorId: 'hpd-complaints', tab: 'hpd', label: 'HPD Complaints', scope: 'building' as DatasetScope },
  serviceRequests: { anchorId: 'service-requests', tab: '311', label: '311 Requests', scope: 'building' as DatasetScope },
  dobPermits: { anchorId: 'dob-permits', tab: 'permits', label: 'DOB Permits', scope: 'building' as DatasetScope },
  salesRecords: { anchorId: 'sales-records', tab: 'all', label: 'Sales Records', scope: 'building' as DatasetScope },
  dobFilingsUnits: { anchorId: 'dob-filings', tab: 'all', label: 'DOB Filings Units', scope: 'building' as DatasetScope },
} as const;

type ChipKey = keyof typeof CHIP_CONFIG;

// Trend status types
type TrendStatus = 'stable' | 'active' | 'escalating' | 'unknown';

interface TrendInfo {
  status: TrendStatus;
  last90Days: number;
  last12Months: number;
  message: string;
  hasDateData: boolean;
}

// Analyze records to determine trend
function analyzeTrend(records: Array<{ issueDate?: string | null }>, total: number): TrendInfo {
  if (total === 0) {
    return {
      status: 'stable',
      last90Days: 0,
      last12Months: 0,
      message: 'No records',
      hasDateData: true,
    };
  }

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  let validDates = 0;
  let last90Days = 0;
  let last12Months = 0;

  for (const record of records) {
    if (record.issueDate) {
      const date = new Date(record.issueDate);
      if (!isNaN(date.getTime())) {
        validDates++;
        if (date >= ninetyDaysAgo) {
          last90Days++;
          last12Months++;
        } else if (date >= oneYearAgo) {
          last12Months++;
        }
      }
    }
  }

  // If less than 50% of records have valid dates, mark as unknown
  if (validDates < total * 0.5) {
    return {
      status: 'unknown',
      last90Days: 0,
      last12Months: 0,
      message: 'Date data unavailable',
      hasDateData: false,
    };
  }

  // Determine status and message
  let status: TrendStatus;
  let message: string;

  if (last90Days > 0) {
    // Recent activity in last 90 days
    if (last12Months >= total * 0.5) {
      // More than half of records are from last 12 months
      status = 'escalating';
      message = `${last90Days} new in last 90 days`;
    } else {
      status = 'active';
      message = `${last90Days} new in last 90 days`;
    }
  } else if (last12Months > 0) {
    // No recent 90-day activity but some in last year
    status = 'active';
    message = `${last12Months} in last 12 months`;
  } else {
    // All records are older than 1 year
    status = 'stable';
    message = 'Most activity >1 year ago';
  }

  return {
    status,
    last90Days,
    last12Months,
    message,
    hasDateData: true,
  };
}

// Get trend icon and color
function getTrendIndicator(status: TrendStatus) {
  switch (status) {
    case 'stable':
      return {
        icon: <Circle className="h-2 w-2 fill-current" />,
        colorClass: 'text-emerald-500',
        bgClass: 'bg-emerald-500/10',
      };
    case 'active':
      return {
        icon: <Minus className="h-2 w-2" />,
        colorClass: 'text-amber-500',
        bgClass: 'bg-amber-500/10',
      };
    case 'escalating':
      return {
        icon: <TrendingUp className="h-2 w-2" />,
        colorClass: 'text-red-500',
        bgClass: 'bg-red-500/10',
      };
    case 'unknown':
    default:
      return {
        icon: <Minus className="h-2 w-2" />,
        colorClass: 'text-muted-foreground',
        bgClass: 'bg-muted/50',
      };
  }
}

interface RiskChipProps {
  label: string;
  count: number;
  loading?: boolean;
  isViolation?: boolean;
  icon: React.ReactNode;
  openCount?: number;
  anchorId: string;
  onClick: () => void;
  trend?: TrendInfo;
}

function RiskChip({ label, count, loading, isViolation, icon, openCount, anchorId, onClick, trend }: RiskChipProps) {
  const [isHovered, setIsHovered] = useState(false);
  const hasRecords = count > 0;
  const showWarning = isViolation && hasRecords;
  
  const trendIndicator = trend ? getTrendIndicator(trend.status) : null;
  
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
      
      {/* Trend indicator */}
      {!loading && trend && count > 0 && (
        <div className={cn(
          "flex items-center gap-1.5 mt-2 px-1.5 py-0.5 rounded text-[10px]",
          trendIndicator?.bgClass
        )}>
          <span className={trendIndicator?.colorClass}>
            {trendIndicator?.icon}
          </span>
          <span className={cn("truncate", trendIndicator?.colorClass)}>
            {trend.message}
          </span>
        </div>
      )}
      
      {!loading && (!trend || count === 0) && (
        <span className="text-[10px] text-muted-foreground/70 mt-2">
          records found
        </span>
      )}
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

// Record arrays for trend analysis
export interface RecordArrays {
  dobViolations?: Array<{ issueDate?: string | null }>;
  ecbViolations?: Array<{ issueDate?: string | null }>;
  hpdViolations?: Array<{ issueDate?: string | null }>;
  hpdComplaints?: Array<{ issueDate?: string | null }>;
  serviceRequests?: Array<{ issueDate?: string | null }>;
  dobPermits?: Array<{ issueDate?: string | null }>;
  salesRecords?: Array<{ issueDate?: string | null }>;
  dobFilingsUnits?: Array<{ issueDate?: string | null }>;
}

export interface NavigationInfo {
  tab: string;
  anchorId: string;
  scope: DatasetScope;
  expectedCount: number;
}

interface RiskSnapshotCardProps {
  counts: RecordCounts;
  loading?: LoadingStates;
  records?: RecordArrays;
  onNavigateToSection?: (info: NavigationInfo) => void;
}

export function RiskSnapshotCard({ counts, loading = {}, records = {}, onNavigateToSection }: RiskSnapshotCardProps) {
  // Check for reduced motion preference
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Compute trends for each category
  const trends = useMemo(() => {
    return {
      dobViolations: records.dobViolations 
        ? analyzeTrend(records.dobViolations, counts.dobViolations) 
        : undefined,
      ecbViolations: records.ecbViolations 
        ? analyzeTrend(records.ecbViolations, counts.ecbViolations) 
        : undefined,
      hpdViolations: records.hpdViolations 
        ? analyzeTrend(records.hpdViolations, counts.hpdViolations) 
        : undefined,
      hpdComplaints: records.hpdComplaints 
        ? analyzeTrend(records.hpdComplaints, counts.hpdComplaints) 
        : undefined,
      serviceRequests: records.serviceRequests 
        ? analyzeTrend(records.serviceRequests, counts.serviceRequests) 
        : undefined,
      dobPermits: records.dobPermits 
        ? analyzeTrend(records.dobPermits, counts.dobPermits) 
        : undefined,
      salesRecords: records.salesRecords 
        ? analyzeTrend(records.salesRecords, counts.salesRecords) 
        : undefined,
      dobFilingsUnits: records.dobFilingsUnits 
        ? analyzeTrend(records.dobFilingsUnits, counts.dobFilingsUnits) 
        : undefined,
    };
  }, [records, counts]);

  const scrollToSection = useCallback((info: NavigationInfo) => {
    // Update URL hash
    const newUrl = `${window.location.pathname}${window.location.search}#${info.anchorId}`;
    window.history.pushState(null, '', newUrl);
    
    // Notify parent to switch tab and scope
    if (onNavigateToSection) {
      onNavigateToSection(info);
    }
    
    // Scroll after a short delay to allow tab switch
    setTimeout(() => {
      const element = document.getElementById(info.anchorId);
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
    const expectedCount = counts[key];
    scrollToSection({
      tab: config.tab,
      anchorId: config.anchorId,
      scope: config.scope,
      expectedCount,
    });
  }, [scrollToSection, counts]);

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
            trend={trends.dobViolations}
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
            trend={trends.ecbViolations}
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
            trend={trends.hpdViolations}
          />
          
          <RiskChip
            label="HPD Complaints"
            count={counts.hpdComplaints}
            openCount={counts.hpdComplaintsOpen}
            loading={loading.hpdComplaints}
            icon={<ClipboardList className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.hpdComplaints.anchorId}
            onClick={() => handleChipClick('hpdComplaints')}
            trend={trends.hpdComplaints}
          />
          
          <RiskChip
            label="311 Requests"
            count={counts.serviceRequests}
            openCount={counts.serviceRequestsOpen}
            loading={loading.serviceRequests}
            icon={<Phone className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.serviceRequests.anchorId}
            onClick={() => handleChipClick('serviceRequests')}
            trend={trends.serviceRequests}
          />
          
          <RiskChip
            label="DOB Permits"
            count={counts.dobPermits}
            loading={loading.dobPermits}
            icon={<Hammer className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.dobPermits.anchorId}
            onClick={() => handleChipClick('dobPermits')}
            trend={trends.dobPermits}
          />
          
          <RiskChip
            label="Sales Records"
            count={counts.salesRecords}
            loading={loading.salesRecords}
            icon={<DollarSign className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.salesRecords.anchorId}
            onClick={() => handleChipClick('salesRecords')}
            trend={trends.salesRecords}
          />
          
          <RiskChip
            label="DOB Filings Units"
            count={counts.dobFilingsUnits}
            loading={loading.dobFilingsUnits}
            icon={<ClipboardList className="h-4 w-4" />}
            anchorId={CHIP_CONFIG.dobFilingsUnits.anchorId}
            onClick={() => handleChipClick('dobFilingsUnits')}
            trend={trends.dobFilingsUnits}
          />
        </div>
        
        {/* Trend legend */}
        <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-border/50">
          <span className="text-[10px] text-muted-foreground">Trend:</span>
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-500"><Circle className="h-2 w-2 fill-current" /></span>
            <span className="text-[10px] text-muted-foreground">Stable</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-amber-500"><Minus className="h-2 w-2" /></span>
            <span className="text-[10px] text-muted-foreground">Active</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-red-500"><TrendingUp className="h-2 w-2" /></span>
            <span className="text-[10px] text-muted-foreground">Escalating</span>
          </div>
        </div>
        
        <p className="text-[10px] text-muted-foreground/70 mt-2">
          Building-level summary from NYC Open Data. Click any card to view details.
        </p>
      </CardContent>
    </Card>
  );
}