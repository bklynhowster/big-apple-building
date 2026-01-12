/**
 * Unified Record Type for All Records Tab
 * Normalizes records from Violations, ECB, Permits, and Safety
 */

export type RecordSource = 'Violation' | 'ECB' | 'Permit' | 'Safety';
export type RecordStatus = 'open' | 'closed' | 'unknown';

export interface UnifiedRecord {
  recordType: RecordSource;
  recordId: string;
  status: RecordStatus;
  primaryDate: string | null;      // Best available: issue date
  secondaryDate: string | null;    // Optional: resolved/completion date
  category: string | null;
  description: string | null;
  source: string;                  // API source identifier
  raw: Record<string, unknown>;
}

// Type for CSV export
export const ALL_RECORDS_COLUMNS = [
  { key: 'primaryDate', header: 'Date' },
  { key: 'recordType', header: 'Type' },
  { key: 'status', header: 'Status' },
  { key: 'category', header: 'Category' },
  { key: 'description', header: 'Description' },
  { key: 'recordId', header: 'Record ID' },
  { key: 'secondaryDate', header: 'Secondary Date' },
];
