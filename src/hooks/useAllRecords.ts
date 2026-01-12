import { useState, useEffect, useMemo, useCallback } from 'react';
import { UnifiedRecord, RecordSource, RecordStatus } from '@/types/unified-record';
import type { ViolationRecord } from './useViolations';
import type { ECBRecord } from './useECB';
import type { PermitRecord } from './usePermits';

export interface AllRecordsFilters {
  recordTypes: RecordSource[];
  status: 'all' | RecordStatus;
  fromDate?: string;
  toDate?: string;
  keyword: string;
}

interface AllRecordsData {
  violations: ViolationRecord[];
  ecb: ECBRecord[];
  permits: PermitRecord[];
  safety: Array<{
    recordType: 'Safety';
    recordId: string;
    status: 'open' | 'closed' | 'unknown';
    issueDate: string | null;
    resolvedDate: string | null;
    category: string | null;
    description: string | null;
    raw: Record<string, unknown>;
  }>;
}

function normalizeStatus(status: string | undefined): RecordStatus {
  if (status === 'open') return 'open';
  if (status === 'resolved' || status === 'closed') return 'closed';
  return 'unknown';
}

function mapViolation(v: ViolationRecord): UnifiedRecord {
  return {
    recordType: 'Violation',
    recordId: v.recordId,
    status: normalizeStatus(v.status),
    primaryDate: v.issueDate,
    secondaryDate: v.resolvedDate,
    category: v.category,
    description: v.description,
    source: 'DOB Violations',
    raw: v.raw,
  };
}

function mapECB(e: ECBRecord): UnifiedRecord {
  return {
    recordType: 'ECB',
    recordId: e.recordId,
    status: normalizeStatus(e.status),
    primaryDate: e.issueDate,
    secondaryDate: e.resolvedDate,
    category: e.category,
    description: e.description,
    source: 'ECB/OATH',
    raw: e.raw,
  };
}

function mapPermit(p: PermitRecord): UnifiedRecord {
  return {
    recordType: 'Permit',
    recordId: p.recordId,
    status: normalizeStatus(p.status),
    primaryDate: p.issueDate,
    secondaryDate: p.expirationDate,
    category: p.permitType || p.category,
    description: p.description,
    source: 'DOB Permits',
    raw: p.raw,
  };
}

function mapSafety(s: AllRecordsData['safety'][0]): UnifiedRecord {
  return {
    recordType: 'Safety',
    recordId: s.recordId,
    status: normalizeStatus(s.status),
    primaryDate: s.issueDate,
    secondaryDate: s.resolvedDate,
    category: s.category,
    description: s.description,
    source: 'DOB Safety',
    raw: s.raw,
  };
}

export function useAllRecords(
  bbl: string,
  rawData: AllRecordsData,
  isLoading: boolean
) {
  const [filters, setFilters] = useState<AllRecordsFilters>({
    recordTypes: ['Violation', 'ECB', 'Permit', 'Safety'],
    status: 'all',
    keyword: '',
  });

  // Merge all records into unified format
  const allRecords = useMemo<UnifiedRecord[]>(() => {
    const records: UnifiedRecord[] = [];
    
    rawData.violations.forEach((v) => records.push(mapViolation(v)));
    rawData.ecb.forEach((e) => records.push(mapECB(e)));
    rawData.permits.forEach((p) => records.push(mapPermit(p)));
    rawData.safety.forEach((s) => records.push(mapSafety(s)));
    
    // Sort by primaryDate descending (newest first)
    records.sort((a, b) => {
      const dateA = a.primaryDate ? new Date(a.primaryDate).getTime() : 0;
      const dateB = b.primaryDate ? new Date(b.primaryDate).getTime() : 0;
      return dateB - dateA;
    });
    
    return records;
  }, [rawData]);

  // Apply filters client-side
  const filteredRecords = useMemo<UnifiedRecord[]>(() => {
    return allRecords.filter((record) => {
      // Record type filter
      if (!filters.recordTypes.includes(record.recordType)) {
        return false;
      }
      
      // Status filter
      if (filters.status !== 'all' && record.status !== filters.status) {
        return false;
      }
      
      // Date range filter
      if (filters.fromDate && record.primaryDate) {
        const recordDate = new Date(record.primaryDate);
        const fromDate = new Date(filters.fromDate);
        if (recordDate < fromDate) return false;
      }
      
      if (filters.toDate && record.primaryDate) {
        const recordDate = new Date(record.primaryDate);
        const toDate = new Date(filters.toDate);
        if (recordDate > toDate) return false;
      }
      
      // Keyword search
      if (filters.keyword) {
        const keyword = filters.keyword.toLowerCase();
        const searchFields = [
          record.recordId,
          record.category,
          record.description,
          record.source,
          JSON.stringify(record.raw),
        ].filter(Boolean).join(' ').toLowerCase();
        
        if (!searchFields.includes(keyword)) {
          return false;
        }
      }
      
      return true;
    });
  }, [allRecords, filters]);

  const updateFilters = useCallback((updates: Partial<AllRecordsFilters>) => {
    setFilters((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({
      recordTypes: ['Violation', 'ECB', 'Permit', 'Safety'],
      status: 'all',
      keyword: '',
    });
  }, []);

  const toggleRecordType = useCallback((type: RecordSource) => {
    setFilters((prev) => {
      const current = prev.recordTypes;
      if (current.includes(type)) {
        // Don't allow deselecting all
        if (current.length === 1) return prev;
        return { ...prev, recordTypes: current.filter((t) => t !== type) };
      }
      return { ...prev, recordTypes: [...current, type] };
    });
  }, []);

  return {
    loading: isLoading,
    allRecords,
    filteredRecords,
    totalCount: allRecords.length,
    filteredCount: filteredRecords.length,
    filters,
    updateFilters,
    resetFilters,
    toggleRecordType,
  };
}
