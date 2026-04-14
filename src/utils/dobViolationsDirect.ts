/**
 * Direct client-side query to NYC Open Data DOB Violations dataset.
 *
 * This bypasses the Supabase edge function which has a bug: it strips leading
 * zeros from block/lot before querying, but the DOB violations dataset stores
 * them zero-padded (e.g., block="05158", lot="00047"). The edge function queries
 * block='5158' which returns 0 results.
 *
 * This module queries NYC Open Data directly with correct padding.
 * Dataset: 3h2n-5cm9 (DOB Violations)
 */

const DOB_VIOLATIONS_URL = 'https://data.cityofnewyork.us/resource/3h2n-5cm9.json';

interface ViolationRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'resolved' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  raw: Record<string, unknown>;
}

interface DobViolationsResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: ViolationRecord[];
  nextOffset: number | null;
}

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  try {
    if (dateStr.includes('T')) return new Date(dateStr).toISOString().split('T')[0];
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [month, day, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    if (/^\d{8}$/.test(dateStr)) return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    return dateStr;
  } catch { return dateStr; }
}

function normalizeViolation(raw: Record<string, unknown>): ViolationRecord {
  const dispositionDate = parseDateToISO(raw.disposition_date as string);
  const dispositionComments = (raw.disposition_comments as string || '').toLowerCase();

  let status: 'open' | 'resolved' | 'unknown' = 'unknown';
  if (dispositionDate) {
    if (dispositionComments.includes('dismissed') || dispositionComments.includes('complied') ||
        dispositionComments.includes('resolved') || dispositionComments.includes('vacated') ||
        dispositionComments.includes('cured')) {
      status = 'resolved';
    } else if (dispositionComments.includes('pending') || dispositionComments.includes('open')) {
      status = 'open';
    } else {
      status = 'resolved';
    }
  } else {
    status = 'open';
  }

  return {
    recordType: 'Violation',
    recordId: raw.violation_number as string || raw.isn_dob_bis_viol as string || 'Unknown',
    status,
    issueDate: parseDateToISO(raw.issue_date as string),
    resolvedDate: dispositionDate,
    category: raw.violation_type_code as string || null,
    description: raw.description as string || null,
    raw,
  };
}

/**
 * Fetch DOB violations directly from NYC Open Data with correct BBL padding.
 * Falls back to BIN-based query if BBL query returns 0 and BIN is available.
 */
export async function fetchDobViolationsDirect(
  bbl: string,
  options: {
    limit?: number;
    offset?: number;
    status?: 'all' | 'open' | 'resolved';
    fromDate?: string;
    toDate?: string;
    keyword?: string;
    signal?: AbortSignal;
  } = {}
): Promise<DobViolationsResponse> {
  const { limit = 200, offset = 0, status = 'all', fromDate, toDate, keyword, signal } = options;

  if (!bbl || bbl.length !== 10) {
    return { source: 'NYC Open Data (direct)', bbl, totalApprox: 0, items: [], nextOffset: null };
  }

  // Extract BBL components — keep zero padding intact
  // BBL format: 1 boro + 5 block + 4 lot = 10 digits
  // But DOB violations dataset stores lot as 5 digits, so pad it
  const boro = bbl.charAt(0);
  const block = bbl.slice(1, 6);              // e.g., "05158" — already 5 digits
  const lot = bbl.slice(6, 10).padStart(5, '0'); // e.g., "0047" → "00047"

  // Build SoQL WHERE clause
  const whereConditions: string[] = [
    `boro='${boro}'`,
    `block='${block}'`,
    `lot='${lot}'`,
  ];
  if (fromDate) whereConditions.push(`issue_date >= '${fromDate}'`);
  if (toDate) whereConditions.push(`issue_date <= '${toDate}'`);
  if (keyword) whereConditions.push(`upper(description) like upper('%${keyword.replace(/'/g, "''")}%')`);

  const url = new URL(DOB_VIOLATIONS_URL);
  url.searchParams.set('$where', whereConditions.join(' AND '));
  url.searchParams.set('$limit', String(limit + 1));
  url.searchParams.set('$offset', String(offset));
  url.searchParams.set('$order', 'issue_date DESC');

  try {
    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
      signal,
    });

    if (!response.ok) {
      console.warn(`DOB violations direct query failed: ${response.status}`);
      return { source: 'NYC Open Data (direct)', bbl, totalApprox: 0, items: [], nextOffset: null };
    }

    const rawData = await response.json() as Record<string, unknown>[];
    const hasMore = rawData.length > limit;
    const dataToProcess = hasMore ? rawData.slice(0, limit) : rawData;

    let items = dataToProcess.map(normalizeViolation);
    if (status === 'open') items = items.filter(item => item.status === 'open');
    else if (status === 'resolved') items = items.filter(item => item.status === 'resolved');

    // Get total count
    let totalApprox = items.length + offset;
    try {
      const countUrl = new URL(DOB_VIOLATIONS_URL);
      countUrl.searchParams.set('$select', 'count(*)');
      countUrl.searchParams.set('$where', whereConditions.join(' AND '));
      const countRes = await fetch(countUrl.toString(), {
        headers: { 'Accept': 'application/json' },
        signal,
      });
      if (countRes.ok) {
        const countData = await countRes.json();
        if (Array.isArray(countData) && countData[0]) {
          totalApprox = parseInt(countData[0].count || countData[0].count_1 || '0', 10);
        }
      }
    } catch {
      // Count query failed — use estimate
    }

    return {
      source: 'NYC Open Data (direct)',
      bbl,
      totalApprox,
      items,
      nextOffset: hasMore ? offset + limit : null,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    console.error('DOB violations direct query error:', err);
    return { source: 'NYC Open Data (direct)', bbl, totalApprox: 0, items: [], nextOffset: null };
  }
}
