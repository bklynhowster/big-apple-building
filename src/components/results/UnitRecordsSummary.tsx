import React from 'react';
import { FileSearch, Building2, MessageSquare, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { RecordCounts, LoadingStates } from './RiskSnapshotCard';

interface UnitRecordsSummaryProps {
  /** Count of records that mention this unit */
  unitMentionCount: number;
  /** Whether mention data is loading */
  mentionsLoading: boolean;
  /** Building-level record counts */
  recordCounts: RecordCounts;
  /** Loading states for building records */
  recordLoading: LoadingStates;
  /** Navigate to building records tab */
  onViewBuildingRecords: () => void;
  /** Open unit mentions detail (if available) */
  onViewUnitMentions?: () => void;
}

interface SummaryRow {
  key: string;
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
  variant: 'highlight' | 'neutral' | 'muted';
  onClick?: () => void;
  loading?: boolean;
}

function SummaryRowItem({ row }: { row: SummaryRow }) {
  const variantClasses = {
    highlight: 'text-foreground',
    neutral: 'text-muted-foreground',
    muted: 'text-muted-foreground/70',
  };
  
  const iconClasses = {
    highlight: 'text-primary',
    neutral: 'text-muted-foreground',
    muted: 'text-muted-foreground/50',
  };

  if (row.loading) {
    return (
      <div className="flex items-center gap-3 py-2">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }

  const content = (
    <div 
      className={cn(
        "flex items-start gap-3 py-2 px-3 -mx-3 rounded-md transition-colors",
        row.onClick && "hover:bg-muted/50 cursor-pointer"
      )}
      onClick={row.onClick}
      role={row.onClick ? "button" : undefined}
      tabIndex={row.onClick ? 0 : undefined}
    >
      <span className={cn("mt-0.5 shrink-0", iconClasses[row.variant])}>
        {row.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm", variantClasses[row.variant])}>
          {row.primary}
        </p>
        {row.secondary && (
          <p className="text-xs text-muted-foreground/70 mt-0.5">{row.secondary}</p>
        )}
      </div>
      {row.onClick && (
        <ArrowRight className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />
      )}
    </div>
  );

  return content;
}

export function UnitRecordsSummary({
  unitMentionCount,
  mentionsLoading,
  recordCounts,
  recordLoading,
  onViewBuildingRecords,
  onViewUnitMentions,
}: UnitRecordsSummaryProps) {
  // Calculate totals
  const totalBuildingViolations = 
    (recordCounts.dobViolationsOpen ?? 0) + 
    (recordCounts.ecbViolationsOpen ?? 0) + 
    (recordCounts.hpdViolationsOpen ?? 0);
  
  const totalBuildingComplaints = 
    (recordCounts.hpdComplaintsOpen ?? 0) + 
    (recordCounts.serviceRequestsOpen ?? 0);

  const isViolationsLoading = 
    recordLoading.dobViolations || 
    recordLoading.ecbViolations || 
    recordLoading.hpdViolations;
  
  const isComplaintsLoading = 
    recordLoading.hpdComplaints || 
    recordLoading.serviceRequests;

  // Build summary rows
  const rows: SummaryRow[] = [];

  // 1. Direct Unit Mentions - Primary
  if (mentionsLoading) {
    rows.push({
      key: 'mentions',
      icon: <FileSearch className="h-4 w-4" />,
      primary: 'Checking for unit mentions...',
      variant: 'neutral',
      loading: true,
    });
  } else if (unitMentionCount > 0) {
    const mentionLabel = unitMentionCount === 1 
      ? '1 record mentions this unit' 
      : `${unitMentionCount} records mention this unit`;
    rows.push({
      key: 'mentions',
      icon: <FileSearch className="h-4 w-4" />,
      primary: mentionLabel,
      secondary: 'Click to view filtered records',
      variant: 'highlight',
      onClick: onViewUnitMentions,
    });
  }

  // 2. Building-Level Issues - Secondary
  if (isViolationsLoading) {
    rows.push({
      key: 'violations',
      icon: <Building2 className="h-4 w-4" />,
      primary: 'Loading building violations...',
      variant: 'neutral',
      loading: true,
    });
  } else if (totalBuildingViolations > 0) {
    rows.push({
      key: 'violations',
      icon: <Building2 className="h-4 w-4" />,
      primary: `${totalBuildingViolations} open building violation${totalBuildingViolations !== 1 ? 's' : ''}`,
      secondary: unitMentionCount === 0 
        ? 'None explicitly reference this unit' 
        : undefined,
      variant: 'neutral',
      onClick: onViewBuildingRecords,
    });
  }

  // 3. Complaints / 311 Context - Tertiary
  if (isComplaintsLoading) {
    rows.push({
      key: 'complaints',
      icon: <MessageSquare className="h-4 w-4" />,
      primary: 'Loading complaints...',
      variant: 'neutral',
      loading: true,
    });
  } else if (totalBuildingComplaints > 0) {
    rows.push({
      key: 'complaints',
      icon: <MessageSquare className="h-4 w-4" />,
      primary: `${totalBuildingComplaints} building complaint${totalBuildingComplaints !== 1 ? 's' : ''} / 311 request${totalBuildingComplaints !== 1 ? 's' : ''}`,
      secondary: 'Building-level context',
      variant: 'muted',
      onClick: onViewBuildingRecords,
    });
  }

  // Check if everything is loaded with no issues
  const allLoaded = !mentionsLoading && !isViolationsLoading && !isComplaintsLoading;
  const noIssues = allLoaded && 
    unitMentionCount === 0 && 
    totalBuildingViolations === 0 && 
    totalBuildingComplaints === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSearch className="h-4 w-4 text-muted-foreground" />
          Records Affecting This Unit
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Summary rows */}
        {rows.length > 0 ? (
          <div className="divide-y divide-border/50">
            {rows.map((row) => (
              <SummaryRowItem key={row.key} row={row} />
            ))}
          </div>
        ) : noIssues ? (
          <div className="flex items-center gap-3 py-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span>No unit-specific enforcement records found.</span>
          </div>
        ) : null}

        {/* Escape hatch - View all building records */}
        <div className="pt-3 border-t border-border/50">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onViewBuildingRecords}
            className="gap-2 text-muted-foreground hover:text-foreground w-full justify-start"
          >
            <ArrowRight className="h-4 w-4" />
            View all building records
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
