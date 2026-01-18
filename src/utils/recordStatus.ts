/**
 * Canonical record status helpers for determining open vs closed/resolved status.
 * 
 * These helpers centralize the logic for computing whether a record is "open"
 * across all NYC dataset types. The same logic is mirrored in the edge functions
 * for server-side normalization.
 * 
 * REFACTOR ONLY: This file extracts existing status logic without changing behavior.
 */

import type { ViolationRecord } from '@/hooks/useViolations';
import type { HPDViolationRecord, HPDComplaintRecord } from '@/hooks/useHPD';
import type { ECBRecord } from '@/hooks/useECB';
import type { ServiceRequestRecord } from '@/hooks/use311';

// Generic record with status field (normalized by edge functions)
export interface StatusRecord {
  status: 'open' | 'closed' | 'resolved' | 'unknown';
}

// Loose type for API responses where status is typed as string
interface LooseStatusRecord {
  status: string;
}

// Type guard to check if status is 'open'
function statusIsOpen(status: string): boolean {
  return status === 'open';
}

/**
 * Check if a DOB Violation is open.
 * 
 * Field used: `status` (normalized by edge function from disposition_date + disposition_comments)
 * - Open: no disposition_date, or comments include "pending"/"open"
 * - Resolved: has disposition_date with "dismissed"/"complied"/"resolved"/"vacated"/"cured"
 * 
 * @see supabase/functions/dob-violations/index.ts:161-174
 */
export function isOpenDOBViolation(record: LooseStatusRecord | ViolationRecord): boolean {
  // Edge function normalizes to 'open' | 'resolved' | 'unknown'
  return statusIsOpen(record.status);
}

/**
 * Check if an HPD Violation is open.
 * 
 * Field used: `status` (normalized by edge function from currentstatus)
 * - Open: currentstatus includes "open" or is empty
 * - Closed: currentstatus includes "close" or "dismissed"
 * 
 * @see supabase/functions/hpd-violations/index.ts:279-284
 */
export function isOpenHPDViolation(record: LooseStatusRecord | HPDViolationRecord): boolean {
  // Edge function normalizes to 'open' | 'closed' | 'unknown'
  return statusIsOpen(record.status);
}

/**
 * Check if an HPD Complaint is open.
 * 
 * Field used: `status` (normalized by edge function from complaintstatus)
 * - Open: status includes "open" or "pending"
 * - Closed: status includes "close"
 * 
 * @see supabase/functions/hpd-complaints/index.ts:272-277
 */
export function isOpenHPDComplaint(record: LooseStatusRecord | HPDComplaintRecord): boolean {
  // Edge function normalizes to 'open' | 'closed' | 'unknown'
  return statusIsOpen(record.status);
}

/**
 * Check if an ECB Violation is open.
 * 
 * Field used: `status` (normalized by edge function from ecb_violation_status + balance_due)
 * - Open: ecb_violation_status is "OPEN" or "ACTIVE", or balance_due > 0
 * - Resolved: ecb_violation_status is "RESOLVE"/"RESOLVED", or hearing_status includes "DISMISSED"
 * 
 * @see supabase/functions/dob-ecb/index.ts:85-91
 */
export function isOpenECB(record: LooseStatusRecord | ECBRecord): boolean {
  // Edge function normalizes to 'open' | 'resolved' | 'unknown'
  return statusIsOpen(record.status);
}

/**
 * Check if a 311 Service Request is open.
 * 
 * Field used: `status` (normalized by edge function from raw status field)
 * - Open: status includes "open", "pending", or "assigned"
 * - Closed: status includes "closed"
 * 
 * @see supabase/functions/service-requests-311/index.ts:150-155
 */
export function isOpen311(record: LooseStatusRecord | ServiceRequestRecord): boolean {
  // Edge function normalizes to 'open' | 'closed' | 'unknown'
  return statusIsOpen(record.status);
}

/**
 * Count open records in a list using the appropriate status helper.
 * Works with both strict StatusRecord types and loose API response types.
 */
export function countOpenRecords<T extends LooseStatusRecord>(
  records: T[],
  isOpenFn: (record: T) => boolean = (r) => r.status === 'open'
): { open: number; total: number } {
  const open = records.filter(isOpenFn).length;
  return { open, total: records.length };
}

/**
 * Debug log helper for record fetch operations.
 * Only logs when debug=1 is in URL.
 */
export function logRecordFetch(
  dataset: string,
  url: string,
  counts: { open: number; total: number }
): void {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') {
      console.log(`[RecordsFetch] ${dataset}`, {
        url,
        openCount: counts.open,
        totalCount: counts.total,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
