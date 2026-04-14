/**
 * Unsafe Building (UB) violation helpers.
 *
 * NYC DOB flags structurally dangerous buildings with violation_type_code prefixed "UB":
 *   UB   = Unsafe Building (active)
 *   UB%  = Precept issued (court case — serious)
 *   UB*  = Rescinded / dismissed
 *   UB+  = Cert of no harassment related (rare)
 *
 * Reference record format: V110685UB130-85  (V + MMDDYY + UB + seq-YY)
 */

export type UbSeverity = 'active' | 'precept' | 'dismissed' | 'other';

export interface UbRecord {
  category?: string | null;
  status?: 'open' | 'resolved' | 'unknown';
}

/** Returns true if the violation category code starts with UB. */
export function isUbCategory(category?: string | null): boolean {
  if (!category) return false;
  const c = String(category).trim().toUpperCase();
  return c.startsWith('UB');
}

/** Classify severity based on the UB suffix. */
export function classifyUb(category?: string | null): UbSeverity | null {
  if (!isUbCategory(category)) return null;
  const c = String(category).trim().toUpperCase();
  if (c === 'UB') return 'active';
  if (c.startsWith('UB%')) return 'precept';
  if (c.startsWith('UB*')) return 'dismissed';
  return 'other';
}

/** Human-readable label for a UB severity tier. */
export function ubSeverityLabel(sev: UbSeverity): string {
  switch (sev) {
    case 'active':    return 'Unsafe Building (active)';
    case 'precept':   return 'UB precept issued';
    case 'dismissed': return 'UB rescinded';
    case 'other':     return 'UB (other)';
  }
}

export interface UbCounts {
  total: number;       // all UB records
  active: number;      // UB + UB% open (structurally dangerous, open)
  precept: number;     // UB% (any status)
  dismissed: number;   // UB*
  open: number;        // any UB still open
}

/** Compute UB counts from a list of violation records. */
export function computeUbCounts(records: UbRecord[] | undefined | null): UbCounts {
  const counts: UbCounts = { total: 0, active: 0, precept: 0, dismissed: 0, open: 0 };
  if (!records || records.length === 0) return counts;

  for (const r of records) {
    const sev = classifyUb(r.category);
    if (!sev) continue;
    counts.total++;
    if (sev === 'active') counts.active++;
    if (sev === 'precept') counts.precept++;
    if (sev === 'dismissed') counts.dismissed++;
    if (r.status === 'open') counts.open++;
  }
  return counts;
}
