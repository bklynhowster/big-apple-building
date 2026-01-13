import { AlertTriangle, FileText, Shield, Building2, Phone, Hammer, DollarSign, ClipboardList, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface RiskChipProps {
  label: string;
  count: number;
  loading?: boolean;
  isViolation?: boolean;
  icon: React.ReactNode;
  openCount?: number;
}

function RiskChip({ label, count, loading, isViolation, icon, openCount }: RiskChipProps) {
  const hasRecords = count > 0;
  const showWarning = isViolation && hasRecords;
  
  return (
    <div 
      className={cn(
        "flex flex-col p-3 rounded-lg border transition-colors",
        showWarning 
          ? "border-warning/50 bg-warning/5" 
          : "border-border bg-card"
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={cn(
          "text-muted-foreground",
          showWarning && "text-warning"
        )}>
          {icon}
        </span>
        {showWarning && (
          <AlertTriangle className="h-3 w-3 text-warning" />
        )}
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
    </div>
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
}

export function RiskSnapshotCard({ counts, loading = {} }: RiskSnapshotCardProps) {
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
          />
          
          <RiskChip
            label="ECB Violations"
            count={counts.ecbViolations}
            openCount={counts.ecbViolationsOpen}
            loading={loading.ecbViolations}
            isViolation
            icon={<FileText className="h-4 w-4" />}
          />
          
          <RiskChip
            label="HPD Violations"
            count={counts.hpdViolations}
            openCount={counts.hpdViolationsOpen}
            loading={loading.hpdViolations}
            isViolation
            icon={<Building2 className="h-4 w-4" />}
          />
          
          <RiskChip
            label="HPD Complaints"
            count={counts.hpdComplaints}
            openCount={counts.hpdComplaintsOpen}
            loading={loading.hpdComplaints}
            icon={<ClipboardList className="h-4 w-4" />}
          />
          
          <RiskChip
            label="311 Requests"
            count={counts.serviceRequests}
            openCount={counts.serviceRequestsOpen}
            loading={loading.serviceRequests}
            icon={<Phone className="h-4 w-4" />}
          />
          
          <RiskChip
            label="DOB Permits"
            count={counts.dobPermits}
            loading={loading.dobPermits}
            icon={<Hammer className="h-4 w-4" />}
          />
          
          <RiskChip
            label="Sales Records"
            count={counts.salesRecords}
            loading={loading.salesRecords}
            icon={<DollarSign className="h-4 w-4" />}
          />
          
          <RiskChip
            label="DOB Filings Units"
            count={counts.dobFilingsUnits}
            loading={loading.dobFilingsUnits}
            icon={<ClipboardList className="h-4 w-4" />}
          />
        </div>
        
        <p className="text-[10px] text-muted-foreground/70 mt-3">
          Building-level summary from NYC Open Data. Counts reflect total records found.
        </p>
      </CardContent>
    </Card>
  );
}
