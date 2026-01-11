import { AlertTriangle, CheckCircle, FileText, Clock, Shield, Hammer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PropertyData } from '@/types/property';

interface SummaryTabProps {
  data: PropertyData;
}

interface StatCardProps {
  title: string;
  total: number;
  open: number;
  resolved: number;
  icon: React.ReactNode;
  lastActivity?: string;
}

function StatCard({ title, total, open, resolved, icon, lastActivity }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-foreground">{total}</div>
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-destructive" />
            <span className="text-xs text-muted-foreground">{open} Open</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-success" />
            <span className="text-xs text-muted-foreground">{resolved} Resolved</span>
          </div>
        </div>
        {lastActivity && (
          <p className="text-xs text-muted-foreground mt-2">
            <Clock className="h-3 w-3 inline mr-1" />
            Last activity: {lastActivity}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function SummaryTab({ data }: SummaryTabProps) {
  const getStats = <T extends { status: string; issueDate?: string }>(items: T[]) => {
    const open = items.filter(i => i.status === 'OPEN').length;
    const resolved = items.filter(i => i.status === 'RESOLVED').length;
    const sorted = [...items].sort((a, b) => 
      new Date(b.issueDate || '').getTime() - new Date(a.issueDate || '').getTime()
    );
    const lastActivity = sorted[0]?.issueDate;
    return { total: items.length, open, resolved, lastActivity };
  };

  const getPermitStats = (items: typeof data.permits) => {
    const open = items.filter(i => ['ISSUED', 'PENDING'].includes(i.status)).length;
    const resolved = items.filter(i => ['COMPLETED', 'EXPIRED'].includes(i.status)).length;
    const sorted = [...items].sort((a, b) => 
      new Date(b.filingDate || '').getTime() - new Date(a.filingDate || '').getTime()
    );
    const lastActivity = sorted[0]?.filingDate;
    return { total: items.length, open, resolved, lastActivity };
  };

  const violationStats = getStats(data.violations);
  const ecbStats = getStats(data.ecbViolations);
  const safetyStats = getStats(data.safetyViolations);
  const permitStats = getPermitStats(data.permits);

  const totalOpen = violationStats.open + ecbStats.open + safetyStats.open + permitStats.open;
  const totalResolved = violationStats.resolved + ecbStats.resolved + safetyStats.resolved + permitStats.resolved;
  const totalRecords = violationStats.total + ecbStats.total + safetyStats.total + permitStats.total;

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card className="bg-accent/50 border-accent-foreground/20">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{totalRecords}</p>
              <p className="text-sm text-muted-foreground">Total Records</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <p className="text-3xl font-bold text-destructive">{totalOpen}</p>
              </div>
              <p className="text-sm text-muted-foreground">Open Issues</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2">
                <CheckCircle className="h-5 w-5 text-success" />
                <p className="text-3xl font-bold text-success">{totalResolved}</p>
              </div>
              <p className="text-sm text-muted-foreground">Resolved</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Category Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="DOB Violations"
          {...violationStats}
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="ECB Violations"
          {...ecbStats}
          icon={<AlertTriangle className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Safety Violations"
          {...safetyStats}
          icon={<Shield className="h-4 w-4 text-muted-foreground" />}
        />
        <StatCard
          title="Permits"
          {...permitStats}
          icon={<Hammer className="h-4 w-4 text-muted-foreground" />}
        />
      </div>
    </div>
  );
}
