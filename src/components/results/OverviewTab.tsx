import React, { useMemo, useState } from 'react';
import { Building2, AlertTriangle, DollarSign, FileWarning, CheckCircle, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { RecordCounts, LoadingStates } from './RiskSnapshotCard';

interface OverviewTabProps {
  // Building identity
  address: string;
  borough: string;
  bbl: string;
  bin?: string;
  
  // Property info
  isCondo: boolean;
  isCoop: boolean;
  totalUnits?: number | null;
  
  // Record counts for status strip
  recordCounts: RecordCounts;
  recordLoading: LoadingStates;
  
  // Tax info (optional)
  hasTaxArrears?: boolean;
  taxLoading?: boolean;
  
  // Navigation
  onTabChange: (tab: string) => void;
}

interface StatusItem {
  key: string;
  label: string;
  value: string | number;
  icon: React.ReactNode;
  variant: 'default' | 'warning' | 'success' | 'muted';
  onClick?: () => void;
}

function StatusStrip({ items, loading }: { items: StatusItem[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const variantClasses = {
          default: 'bg-muted text-foreground',
          warning: 'bg-warning/10 text-warning border-warning/30',
          success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
          muted: 'bg-muted/50 text-muted-foreground',
        };
        
        return (
          <button
            key={item.key}
            onClick={item.onClick}
            disabled={!item.onClick}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
              variantClasses[item.variant],
              item.onClick && "hover:opacity-80 cursor-pointer",
              !item.onClick && "cursor-default"
            )}
          >
            {item.icon}
            <span>{item.label}:</span>
            <span className="font-semibold">{item.value}</span>
          </button>
        );
      })}
    </div>
  );
}

interface HighlightItem {
  key: string;
  text: string;
  variant: 'info' | 'warning' | 'success';
}

function HighlightsSection({ highlights }: { highlights: HighlightItem[] }) {
  if (highlights.length === 0) return null;
  
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">Highlights</h3>
      <div className="flex flex-wrap gap-2">
        {highlights.map((item) => {
          const variantClasses = {
            info: 'bg-primary/10 text-primary',
            warning: 'bg-warning/10 text-warning',
            success: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
          };
          
          return (
            <span
              key={item.key}
              className={cn(
                "inline-flex items-center px-3 py-1.5 rounded-md text-sm",
                variantClasses[item.variant]
              )}
            >
              {item.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ZeroCategoryList({ 
  zeroCategories, 
  showAll, 
  onToggle 
}: { 
  zeroCategories: string[]; 
  showAll: boolean; 
  onToggle: () => void;
}) {
  if (zeroCategories.length === 0) return null;
  
  return (
    <Collapsible open={showAll} onOpenChange={onToggle}>
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <ChevronDown className={cn("h-4 w-4 transition-transform", showAll && "rotate-180")} />
            {showAll ? 'Hide' : 'Show'} {zeroCategories.length} categories with 0 records
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="pt-2">
        <div className="flex flex-wrap gap-2">
          {zeroCategories.map((cat) => (
            <span key={cat} className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
              {cat}: 0
            </span>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function OverviewTab({
  address,
  borough,
  bbl,
  bin,
  isCondo,
  isCoop,
  totalUnits,
  recordCounts,
  recordLoading,
  hasTaxArrears,
  taxLoading,
  onTabChange,
}: OverviewTabProps) {
  const [showZeroCategories, setShowZeroCategories] = useState(false);

  // Calculate open violations total
  const totalOpenViolations = useMemo(() => {
    return (recordCounts.dobViolationsOpen || 0) + 
           (recordCounts.ecbViolationsOpen || 0) + 
           (recordCounts.hpdViolationsOpen || 0);
  }, [recordCounts]);

  // Loading state
  const isLoading = Object.values(recordLoading).some(Boolean) || taxLoading;

  // Build status items
  const statusItems = useMemo<StatusItem[]>(() => {
    const items: StatusItem[] = [];
    
    // Open violations
    if (totalOpenViolations > 0 || !isLoading) {
      items.push({
        key: 'violations',
        label: 'Open Violations',
        value: totalOpenViolations,
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        variant: totalOpenViolations > 0 ? 'warning' : 'success',
        onClick: () => onTabChange('records'),
      });
    }
    
    // Tax arrears (if provided)
    if (hasTaxArrears !== undefined) {
      items.push({
        key: 'taxes',
        label: 'Tax Arrears',
        value: hasTaxArrears ? 'Present' : 'None',
        icon: <DollarSign className="h-3.5 w-3.5" />,
        variant: hasTaxArrears ? 'warning' : 'success',
      });
    }
    
    // Open complaints
    const openComplaints = (recordCounts.hpdComplaintsOpen || 0) + (recordCounts.serviceRequestsOpen || 0);
    if (openComplaints > 0 || !isLoading) {
      items.push({
        key: 'complaints',
        label: 'Open Complaints',
        value: openComplaints,
        icon: <FileWarning className="h-3.5 w-3.5" />,
        variant: openComplaints > 0 ? 'warning' : 'success',
        onClick: () => onTabChange('records'),
      });
    }
    
    return items;
  }, [totalOpenViolations, hasTaxArrears, recordCounts, isLoading, onTabChange]);

  // Build highlights
  const highlights = useMemo<HighlightItem[]>(() => {
    const items: HighlightItem[] = [];
    
    // Property type
    if (isCondo) {
      items.push({
        key: 'condo',
        text: totalUnits ? `${totalUnits} condo units` : 'Condominium building',
        variant: 'info',
      });
    } else if (isCoop) {
      items.push({
        key: 'coop',
        text: totalUnits ? `${totalUnits}-unit co-op` : 'Co-op building',
        variant: 'info',
      });
    }
    
    // Tax status for condos
    if (isCondo) {
      items.push({
        key: 'condo-tax',
        text: 'No building-level tax liability',
        variant: 'info',
      });
    }
    
    // All clear status
    if (totalOpenViolations === 0 && !hasTaxArrears && !isLoading) {
      items.push({
        key: 'clear',
        text: 'No open issues',
        variant: 'success',
      });
    }
    
    return items;
  }, [isCondo, isCoop, totalUnits, totalOpenViolations, hasTaxArrears, isLoading]);

  // Categories with zero records (for collapsible section)
  const zeroCategories = useMemo(() => {
    const cats: string[] = [];
    if (recordCounts.dobViolations === 0 && !recordLoading.dobViolations) cats.push('DOB Violations');
    if (recordCounts.ecbViolations === 0 && !recordLoading.ecbViolations) cats.push('ECB Violations');
    if (recordCounts.hpdViolations === 0 && !recordLoading.hpdViolations) cats.push('HPD Violations');
    if (recordCounts.hpdComplaints === 0 && !recordLoading.hpdComplaints) cats.push('HPD Complaints');
    if (recordCounts.serviceRequests === 0 && !recordLoading.serviceRequests) cats.push('311 Requests');
    if (recordCounts.dobPermits === 0 && !recordLoading.dobPermits) cats.push('Permits');
    return cats;
  }, [recordCounts, recordLoading]);

  return (
    <div className="space-y-6">
      {/* Building Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg shrink-0">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <CardTitle className="text-xl">{address || 'Property Details'}</CardTitle>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{borough}</span>
                <span className="font-mono">BBL: {bbl}</span>
                {bin && <span className="font-mono">BIN: {bin}</span>}
              </div>
              {(isCondo || isCoop) && (
                <Badge variant="secondary" className="mt-1">
                  {isCondo ? 'Condominium' : 'Co-op'}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Condo Units CTA - Prominent for condo buildings */}
      {isCondo && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 bg-primary/20 rounded-lg">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Condo Units</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {totalUnits ? `${totalUnits} registered units` : 'View the official unit roster'}
                  </p>
                </div>
              </div>
              <Button onClick={() => onTabChange('units')} className="gap-2">
                <Building2 className="h-4 w-4" />
                View All Units
              </Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {/* Status Strip */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
            Status at a Glance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StatusStrip items={statusItems} loading={isLoading} />
        </CardContent>
      </Card>

      {/* Highlights */}
      {highlights.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <HighlightsSection highlights={highlights} />
          </CardContent>
        </Card>
      )}

      {/* Zero categories toggle */}
      {zeroCategories.length > 0 && (
        <ZeroCategoryList
          zeroCategories={zeroCategories}
          showAll={showZeroCategories}
          onToggle={() => setShowZeroCategories(!showZeroCategories)}
        />
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onTabChange('records')}>
          View All Records
        </Button>
        {isCoop && (
          <Button variant="outline" size="sm" onClick={() => onTabChange('units')}>
            View Unit Info
          </Button>
        )}
      </div>
    </div>
  );
}
