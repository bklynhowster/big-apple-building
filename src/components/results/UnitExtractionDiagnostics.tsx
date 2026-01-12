/**
 * DEV-only diagnostics panel for unit extraction debugging.
 * Only renders when import.meta.env.DEV && URL includes ?debug=1.
 */

import { useMemo } from 'react';
import { ChevronDown, Bug, CheckCircle, XCircle } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { extractUnitFromRecordWithTrace, normalizeUnit } from '@/utils/unit';
import type { HPDComplaintRecord, HPDViolationRecord } from '@/hooks/useHPD';
import type { ServiceRequestRecord } from '@/hooks/use311';
import type { UnitRosterEntry } from '@/hooks/useCoopUnitRoster';
import type { UnitFromFilings } from '@/hooks/useDobJobFilings';
import type { ViolationRecord } from '@/hooks/useViolations';
import type { ECBRecord } from '@/hooks/useECB';
import type { PermitRecord } from '@/hooks/usePermits';

// Check if diagnostics should render
const SHOW_DIAGNOSTICS = import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('debug=1');

interface SourceDiagnostics {
  name: string;
  recordsFetched: number;
  recordsWithAnyText: number;
  recordsWithCandidateTokens: number;
  recordsWithValidatedUnits: number;
  extractedUnits: Map<string, number>;
  rejectedTokens: Array<{ token: string; reason: string }>;
}

interface DiagnosticsData {
  sources: SourceDiagnostics[];
  topExtractedUnits: Array<{ unit: string; count: number }>;
  topRejectedTokens: Array<{ token: string; reason: string; count: number }>;
  totalRecords: number;
  totalWithCandidates: number;
  totalValidated: number;
}

// Helper to extract all string values from a record (bounded)
function extractAllStrings(record: Record<string, unknown>, maxStrings = 50, maxLength = 500): string[] {
  const strings: string[] = [];
  
  function walk(val: unknown, depth: number): void {
    if (depth > 5 || strings.length >= maxStrings) return;
    
    if (typeof val === 'string' && val.length > 0 && val.length <= maxLength) {
      strings.push(val);
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      strings.push(String(val));
    } else if (Array.isArray(val)) {
      for (const item of val.slice(0, 10)) {
        walk(item, depth + 1);
      }
    } else if (val && typeof val === 'object') {
      for (const key of Object.keys(val).slice(0, 30)) {
        walk((val as Record<string, unknown>)[key], depth + 1);
      }
    }
  }
  
  walk(record, 0);
  return strings;
}

// Regex to detect unit-like patterns in text (candidates before validation)
const UNIT_CANDIDATE_PATTERN = /\b(APT\.?\s*[A-Z0-9]{1,8}|APARTMENT\s*[A-Z0-9]{1,8}|UNIT\s*[A-Z0-9]{1,8}|#\s*[A-Z0-9]{1,8}|PH[A-Z0-9]{0,3}|PENTHOUSE\s*[A-Z0-9]{0,3})\b/gi;

function analyzeRecords<T extends { raw: Record<string, unknown> }>(
  records: T[],
  sourceName: string
): SourceDiagnostics {
  const extractedUnits = new Map<string, number>();
  const rejectedTokens: Array<{ token: string; reason: string }> = [];
  let recordsWithAnyText = 0;
  let recordsWithCandidateTokens = 0;
  let recordsWithValidatedUnits = 0;
  
  for (const record of records) {
    const raw = record.raw;
    if (!raw) continue;
    
    // Check if record has any text
    const allStrings = extractAllStrings(raw);
    if (allStrings.length > 0) {
      recordsWithAnyText++;
    }
    
    // Check for candidate tokens (before validation)
    const combinedText = allStrings.join(' ');
    const candidates = combinedText.match(UNIT_CANDIDATE_PATTERN);
    if (candidates && candidates.length > 0) {
      recordsWithCandidateTokens++;
    }
    
    // Try extraction with trace
    const extraction = extractUnitFromRecordWithTrace(raw);
    if (extraction) {
      recordsWithValidatedUnits++;
      const unit = extraction.normalizedUnit;
      extractedUnits.set(unit, (extractedUnits.get(unit) || 0) + 1);
    } else if (candidates && candidates.length > 0) {
      // We had candidates but none validated - track rejections
      for (const candidate of candidates.slice(0, 3)) {
        const cleaned = candidate.replace(/^(APT\.?|APARTMENT|UNIT|#)\s*/i, '').trim().toUpperCase();
        const normalized = normalizeUnit(cleaned);
        if (!normalized) {
          rejectedTokens.push({
            token: cleaned.slice(0, 20),
            reason: cleaned.length > 8 ? 'too long' : 
                   /^\d{4,}$/.test(cleaned) ? 'numeric (4+ digits)' :
                   /STREET|AVE|ROAD|BLVD/i.test(cleaned) ? 'address-like' :
                   'failed validation'
          });
        }
      }
    }
  }
  
  return {
    name: sourceName,
    recordsFetched: records.length,
    recordsWithAnyText,
    recordsWithCandidateTokens,
    recordsWithValidatedUnits,
    extractedUnits,
    rejectedTokens: rejectedTokens.slice(0, 10),
  };
}

// Analyze filings units (already extracted by edge function)
function analyzeFilingsUnits(units: UnitFromFilings[]): SourceDiagnostics {
  const extractedUnits = new Map<string, number>();
  
  for (const u of units) {
    extractedUnits.set(u.unit, u.count);
  }
  
  return {
    name: 'DOB Job Filings',
    recordsFetched: units.length,
    recordsWithAnyText: units.length,
    recordsWithCandidateTokens: units.length,
    recordsWithValidatedUnits: units.length,
    extractedUnits,
    rejectedTokens: [],
  };
}

// Analyze sales units (already extracted)
function analyzeSalesUnits(units: UnitRosterEntry[]): SourceDiagnostics {
  const extractedUnits = new Map<string, number>();
  
  for (const u of units) {
    extractedUnits.set(u.unit, u.count);
  }
  
  return {
    name: 'Sales/Roster',
    recordsFetched: units.length,
    recordsWithAnyText: units.length,
    recordsWithCandidateTokens: units.length,
    recordsWithValidatedUnits: units.length,
    extractedUnits,
    rejectedTokens: [],
  };
}

export interface UnitExtractionDiagnosticsProps {
  hpdViolations: HPDViolationRecord[];
  hpdComplaints: HPDComplaintRecord[];
  serviceRequests: ServiceRequestRecord[];
  dobPermits: PermitRecord[];
  dobViolations: ViolationRecord[];
  ecbViolations: ECBRecord[];
  dobFilingsUnits: UnitFromFilings[];
  salesUnits: UnitRosterEntry[];
}

export function UnitExtractionDiagnostics({
  hpdViolations,
  hpdComplaints,
  serviceRequests,
  dobPermits,
  dobViolations,
  ecbViolations,
  dobFilingsUnits,
  salesUnits,
}: UnitExtractionDiagnosticsProps) {
  // Only render in DEV with ?debug=1
  if (!SHOW_DIAGNOSTICS) return null;
  
  const diagnostics = useMemo<DiagnosticsData>(() => {
    const sources: SourceDiagnostics[] = [
      analyzeRecords(hpdViolations, 'HPD Violations'),
      analyzeRecords(hpdComplaints, 'HPD Complaints'),
      analyzeRecords(serviceRequests, '311 Requests'),
      analyzeRecords(dobPermits, 'DOB Permits'),
      analyzeRecords(dobViolations, 'DOB Violations'),
      analyzeRecords(ecbViolations, 'ECB Violations'),
      analyzeFilingsUnits(dobFilingsUnits),
      analyzeSalesUnits(salesUnits),
    ];
    
    // Aggregate extracted units across all sources
    const allExtracted = new Map<string, number>();
    for (const src of sources) {
      for (const [unit, count] of src.extractedUnits) {
        allExtracted.set(unit, (allExtracted.get(unit) || 0) + count);
      }
    }
    
    // Sort by count descending
    const topExtractedUnits = Array.from(allExtracted.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([unit, count]) => ({ unit, count }));
    
    // Aggregate rejected tokens
    const rejectedMap = new Map<string, { reason: string; count: number }>();
    for (const src of sources) {
      for (const rej of src.rejectedTokens) {
        const key = `${rej.token}|${rej.reason}`;
        const existing = rejectedMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          rejectedMap.set(key, { reason: rej.reason, count: 1 });
        }
      }
    }
    
    const topRejectedTokens = Array.from(rejectedMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([key, val]) => ({
        token: key.split('|')[0],
        reason: val.reason,
        count: val.count,
      }));
    
    const totalRecords = sources.reduce((sum, s) => sum + s.recordsFetched, 0);
    const totalWithCandidates = sources.reduce((sum, s) => sum + s.recordsWithCandidateTokens, 0);
    const totalValidated = sources.reduce((sum, s) => sum + s.recordsWithValidatedUnits, 0);
    
    return {
      sources,
      topExtractedUnits,
      topRejectedTokens,
      totalRecords,
      totalWithCandidates,
      totalValidated,
    };
  }, [hpdViolations, hpdComplaints, serviceRequests, dobPermits, dobViolations, ecbViolations, dobFilingsUnits, salesUnits]);
  
  return (
    <Collapsible className="mt-4 border border-amber-500 rounded-lg bg-amber-50 dark:bg-amber-950/30">
      <CollapsibleTrigger className="w-full p-3 flex items-center justify-between text-sm font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-t-lg">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4" />
          Unit Extraction Diagnostics (DEV)
        </div>
        <ChevronDown className="h-4 w-4" />
      </CollapsibleTrigger>
      <CollapsibleContent className="p-3 border-t border-amber-300 dark:border-amber-700 space-y-4 text-xs">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/50 p-2 rounded">
            <div className="text-lg font-bold">{diagnostics.totalRecords}</div>
            <div className="text-muted-foreground">Total Records</div>
          </div>
          <div className="bg-muted/50 p-2 rounded">
            <div className="text-lg font-bold text-amber-600">{diagnostics.totalWithCandidates}</div>
            <div className="text-muted-foreground">With Candidates</div>
          </div>
          <div className="bg-muted/50 p-2 rounded">
            <div className="text-lg font-bold text-green-600">{diagnostics.totalValidated}</div>
            <div className="text-muted-foreground">Validated</div>
          </div>
        </div>
        
        {/* Per-source breakdown */}
        <div className="space-y-1">
          <div className="font-semibold text-muted-foreground">By Source:</div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-1">Source</th>
                <th className="pb-1 text-center">Fetched</th>
                <th className="pb-1 text-center">Text</th>
                <th className="pb-1 text-center">Candidates</th>
                <th className="pb-1 text-center">Validated</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.sources.map(src => (
                <tr key={src.name} className={src.recordsWithValidatedUnits > 0 ? 'text-green-700 dark:text-green-400' : ''}>
                  <td className="py-0.5">{src.name}</td>
                  <td className="text-center">{src.recordsFetched}</td>
                  <td className="text-center">{src.recordsWithAnyText}</td>
                  <td className="text-center">{src.recordsWithCandidateTokens}</td>
                  <td className="text-center font-medium">{src.recordsWithValidatedUnits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Top extracted units */}
        <div className="space-y-1">
          <div className="font-semibold text-muted-foreground flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-600" />
            Top 10 Extracted Units:
          </div>
          {diagnostics.topExtractedUnits.length === 0 ? (
            <div className="text-muted-foreground italic">None extracted</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {diagnostics.topExtractedUnits.map(({ unit, count }) => (
                <Badge key={unit} variant="secondary" className="text-[10px] font-mono">
                  {unit} ({count})
                </Badge>
              ))}
            </div>
          )}
        </div>
        
        {/* Top rejected tokens */}
        <div className="space-y-1">
          <div className="font-semibold text-muted-foreground flex items-center gap-1">
            <XCircle className="h-3 w-3 text-red-600" />
            Top 10 Rejected Tokens:
          </div>
          {diagnostics.topRejectedTokens.length === 0 ? (
            <div className="text-muted-foreground italic">None rejected (or no candidates found)</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {diagnostics.topRejectedTokens.map(({ token, reason, count }, idx) => (
                <Badge key={`${token}-${idx}`} variant="outline" className="text-[10px] font-mono text-red-700 dark:text-red-400">
                  {token} ({reason}) ×{count}
                </Badge>
              ))}
            </div>
          )}
        </div>
        
        {/* Diagnostic conclusion */}
        {diagnostics.totalWithCandidates > 0 && diagnostics.totalValidated === 0 && (
          <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded text-red-800 dark:text-red-200">
            <strong>Issue detected:</strong> Found {diagnostics.totalWithCandidates} records with unit-like patterns but 0 passed validation. 
            Check isLikelyUnitLabel patterns - they may be too strict.
          </div>
        )}
        {diagnostics.totalWithCandidates === 0 && diagnostics.totalRecords > 0 && (
          <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded text-amber-800 dark:text-amber-200">
            <strong>Issue detected:</strong> Scanned {diagnostics.totalRecords} records but found 0 candidate patterns. 
            Check if TEXT_EXTRACTION_FIELDS / UNIT_FIELDS match the actual raw record keys.
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
