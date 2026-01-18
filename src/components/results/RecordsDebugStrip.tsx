/**
 * Developer-only debug strip that displays record query context.
 * Only renders when ?debug=1 is present in the URL.
 */

import { useSearchParams } from 'react-router-dom';
import { Bug, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { RecordCounts, LoadingStates } from './RiskSnapshotCard';

interface RecordsDebugStripProps {
  // View context
  viewMode: 'building' | 'unit';
  activeTab: string;
  
  // Building identifiers
  buildingBbl: string;
  billingBbl?: string | null;
  unitBbl?: string | null;
  bin?: string;
  
  // Building classification
  isCondo: boolean;
  isCoop: boolean;
  unitsCount?: number | null;
  
  // Coordinates (for 311)
  lat?: number;
  lon?: number;
  
  // Record counts from parent
  recordCounts: RecordCounts;
  recordLoading: LoadingStates;
}

interface DatasetQueryInfo {
  name: string;
  params: Record<string, string | number | undefined>;
  counts: { open: number; total: number };
  loading: boolean;
}

export function RecordsDebugStrip({
  viewMode,
  activeTab,
  buildingBbl,
  billingBbl,
  unitBbl,
  bin,
  isCondo,
  isCoop,
  unitsCount,
  lat,
  lon,
  recordCounts,
  recordLoading,
}: RecordsDebugStripProps) {
  const [searchParams] = useSearchParams();
  const [isExpanded, setIsExpanded] = useState(true);
  
  // Only render in debug mode
  const isDebugMode = searchParams.get('debug') === '1';
  if (!isDebugMode) return null;

  // Compute effective BBL used for queries
  const effectiveQueryBbl = unitBbl || buildingBbl;
  
  // Build dataset query info
  const datasets: DatasetQueryInfo[] = useMemo(() => [
    {
      name: 'DOB Violations',
      params: { bbl: effectiveQueryBbl, bin, limit: 50, offset: 0 },
      counts: { open: recordCounts.dobViolationsOpen || 0, total: recordCounts.dobViolations },
      loading: recordLoading.dobViolations,
    },
    {
      name: 'ECB Violations',
      params: { bbl: effectiveQueryBbl, bin, limit: 50, offset: 0 },
      counts: { open: recordCounts.ecbViolationsOpen || 0, total: recordCounts.ecbViolations },
      loading: recordLoading.ecbViolations,
    },
    {
      name: 'HPD Violations',
      params: { bbl: buildingBbl, limit: 50, offset: 0 },
      counts: { open: recordCounts.hpdViolationsOpen || 0, total: recordCounts.hpdViolations },
      loading: recordLoading.hpdViolations,
    },
    {
      name: 'HPD Complaints',
      params: { bbl: buildingBbl, limit: 50, offset: 0 },
      counts: { open: recordCounts.hpdComplaintsOpen || 0, total: recordCounts.hpdComplaints },
      loading: recordLoading.hpdComplaints,
    },
    {
      name: 'DOB Permits',
      params: { bbl: effectiveQueryBbl, bin, limit: 50, offset: 0 },
      counts: { open: 0, total: recordCounts.dobPermits },
      loading: recordLoading.dobPermits,
    },
    {
      name: '311 Requests',
      params: { lat, lon, radiusMeters: 250, limit: 100, offset: 0 },
      counts: { open: recordCounts.serviceRequestsOpen || 0, total: recordCounts.serviceRequests },
      loading: recordLoading.serviceRequests,
    },
  ], [effectiveQueryBbl, bin, buildingBbl, lat, lon, recordCounts, recordLoading]);

  // Compute building type label
  const buildingTypeLabel = isCondo ? 'Condominium' : isCoop ? 'Co-op' : 'Multifamily';

  return (
    <div className="bg-amber-950/80 border border-amber-600/50 rounded-lg text-amber-100 text-xs font-mono overflow-hidden">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full flex items-center justify-between px-3 py-2 h-auto hover:bg-amber-900/50 text-amber-100"
          >
            <div className="flex items-center gap-2">
              <Bug className="h-3.5 w-3.5" />
              <span className="font-semibold">Debug: Records Query Context</span>
              <Badge variant="outline" className="text-[10px] border-amber-600/50 text-amber-200">
                ?debug=1
              </Badge>
            </div>
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3">
            {/* Context section */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <span className="text-amber-400">viewMode:</span>{' '}
                <span className="text-white">{viewMode}</span>
              </div>
              <div>
                <span className="text-amber-400">activeTab:</span>{' '}
                <span className="text-white">{activeTab}</span>
              </div>
              <div>
                <span className="text-amber-400">buildingType:</span>{' '}
                <span className="text-white">{buildingTypeLabel}</span>
              </div>
              <div>
                <span className="text-amber-400">unitsCount:</span>{' '}
                <span className="text-white">{unitsCount ?? 'null'}</span>
              </div>
            </div>

            {/* Identifiers section */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-amber-700/50 pt-2">
              <div>
                <span className="text-amber-400">buildingBbl:</span>{' '}
                <span className="text-white">{buildingBbl}</span>
              </div>
              <div>
                <span className="text-amber-400">billingBbl:</span>{' '}
                <span className="text-white">{billingBbl || 'null'}</span>
              </div>
              <div>
                <span className="text-amber-400">unitBbl:</span>{' '}
                <span className="text-white">{unitBbl || 'null'}</span>
              </div>
              <div>
                <span className="text-amber-400">bin:</span>{' '}
                <span className="text-white">{bin || 'null'}</span>
              </div>
            </div>

            {/* Dataset queries section */}
            <div className="border-t border-amber-700/50 pt-2">
              <div className="text-amber-400 mb-1">Dataset Query Params & Counts:</div>
              <div className="space-y-1">
                {datasets.map((ds) => (
                  <div 
                    key={ds.name} 
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-amber-900/30 px-2 py-1 rounded"
                  >
                    <span className="text-amber-200 font-medium min-w-[120px]">{ds.name}:</span>
                    <span className="text-amber-100/70">
                      {Object.entries(ds.params)
                        .filter(([, v]) => v !== undefined)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(', ')}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {ds.loading ? (
                        <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-300">
                          loading...
                        </Badge>
                      ) : (
                        <>
                          <span className="text-green-400">{ds.counts.open} open</span>
                          <span className="text-amber-100/50">/</span>
                          <span className="text-white">{ds.counts.total} total</span>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
