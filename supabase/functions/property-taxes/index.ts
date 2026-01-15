import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data DOF Property Charges Balance dataset (ledger rows)
const DATASET_ID = 'scjx-j6np';
const BASE_URL = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`;

// In-memory cache
interface CacheEntry {
  data: unknown;
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Billing cycle types
type BillingCycle = 'Quarterly' | 'Semiannual' | 'Unknown';
type PaymentStatus = 'paid' | 'unpaid' | 'unknown';

// Normalize BBL to 10-digit format
function normalizeBbl(bbl: string): string {
  if (!bbl || bbl.length < 5) return bbl;
  const cleaned = bbl.replace(/\D/g, '');
  if (cleaned.length === 10) {
    const borough = cleaned.charAt(0);
    const block = cleaned.slice(1, 6).padStart(5, '0');
    const lot = cleaned.slice(6, 10).padStart(4, '0');
    return `${borough}${block}${lot}`;
  }
  return cleaned.padStart(10, '0');
}

// Generate candidate keys for lookup
function generateCandidateKeys(bbl: string): string[] {
  const candidates: string[] = [];
  const original = bbl.padStart(10, '0');
  candidates.push(original);
  candidates.push(original + '0'); // Some datasets use 11-digit parid
  const normalized = normalizeBbl(bbl);
  if (normalized !== original) {
    candidates.push(normalized);
    candidates.push(normalized + '0');
  }
  return [...new Set(candidates)];
}

// Raw row from NYC Open Data
interface RawRow {
  [key: string]: unknown;
}

// Parsed ledger row
interface LedgerRow {
  dueDate: Date | null;
  dueDateStr: string | null;
  liability: number | null;  // sum_liab - the charge amount
  balance: number | null;    // sum_bal - remaining balance
  code: string | null;       // charge code (CHG, PMT, etc.)
  cycle: string | null;      // billing cycle indicator
  rawRow: RawRow;
}

// Field candidates for extraction
const DUE_DATE_FIELDS = ['due_date', 'dt_pd_begin', 'dt_pd_end', 'stmtdate', 'bill_date', 'effective_date'];
const LIABILITY_FIELDS = ['sum_liab', 'amount', 'charge_amount', 'original_amount', 'billed_amount'];
const BALANCE_FIELDS = ['sum_bal', 'open_balance', 'outstanding_amount', 'outstanding_balance', 'balance'];
const CODE_FIELDS = ['code', 'type', 'charge_type', 'chargetype'];
const CYCLE_FIELDS = ['cycle', 'billing_cycle'];

// Get first matching field value
function getFieldValue(row: RawRow, candidates: string[]): string | number | null {
  for (const field of candidates) {
    const val = row[field];
    if (val !== undefined && val !== null && val !== '') {
      return typeof val === 'number' ? val : String(val);
    }
  }
  return null;
}

// Parse date string to Date object
function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

// Parse numeric value
function parseNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(num) ? null : num;
}

// Format date for display
function formatDateDisplay(date: Date): string {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
}

// Parse a raw row into structured LedgerRow
function parseRow(raw: RawRow): LedgerRow {
  const dueDateRaw = getFieldValue(raw, DUE_DATE_FIELDS);
  const dueDateStr = dueDateRaw ? String(dueDateRaw) : null;
  const dueDate = parseDate(dueDateStr);
  
  const liabilityRaw = getFieldValue(raw, LIABILITY_FIELDS);
  const liability = parseNumber(liabilityRaw);
  
  const balanceRaw = getFieldValue(raw, BALANCE_FIELDS);
  const balance = parseNumber(balanceRaw);
  
  const codeRaw = getFieldValue(raw, CODE_FIELDS);
  const code = codeRaw ? String(codeRaw).toUpperCase().trim() : null;
  
  const cycleRaw = getFieldValue(raw, CYCLE_FIELDS);
  const cycle = cycleRaw ? String(cycleRaw) : null;
  
  return { dueDate, dueDateStr, liability, balance, code, cycle, rawRow: raw };
}

// Infer billing cycle from due date patterns
function inferBillingCycle(rows: LedgerRow[]): { cycle: BillingCycle; evidence: string } {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  // Get unique due date months from last 12 months
  const recentRows = rows.filter(r => r.dueDate && r.dueDate >= oneYearAgo);
  const uniqueMonths = new Set<number>();
  
  for (const row of recentRows) {
    if (row.dueDate) {
      uniqueMonths.add(row.dueDate.getMonth());
    }
  }
  
  const monthsArray = Array.from(uniqueMonths).sort((a, b) => a - b);
  
  // Quarterly pattern: Jan(0), Apr(3), Jul(6), Oct(9) - 4 months
  // Semiannual pattern: Jan(0), Jul(6) - 2 months
  const quarterlyMonths = [0, 3, 6, 9];
  const semiannualMonths = [0, 6];
  
  // Check if matches quarterly pattern (any 3-4 of the quarterly months)
  const matchedQuarterly = monthsArray.filter(m => quarterlyMonths.includes(m));
  const matchedSemiannual = monthsArray.filter(m => semiannualMonths.includes(m));
  
  if (matchedQuarterly.length >= 3) {
    return { 
      cycle: 'Quarterly', 
      evidence: `Found ${matchedQuarterly.length} quarterly due date months: ${monthsArray.map(m => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]).join(', ')}`
    };
  }
  
  if (matchedSemiannual.length === 2 && monthsArray.length <= 3) {
    return { 
      cycle: 'Semiannual', 
      evidence: `Found semiannual pattern: ${monthsArray.map(m => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]).join(', ')}`
    };
  }
  
  if (uniqueMonths.size === 0) {
    return { cycle: 'Unknown', evidence: 'No due dates found in last 12 months' };
  }
  
  return { 
    cycle: 'Unknown', 
    evidence: `Inconclusive pattern: months found = ${monthsArray.map(m => ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m]).join(', ')}`
  };
}

// Filter to bill charge rows (positive liability, has due date)
function filterBillRows(rows: LedgerRow[]): { billRows: LedgerRow[]; excludedCount: number; exclusionReasons: string[] } {
  const exclusionReasons: string[] = [];
  let excludedCount = 0;
  
  const billRows = rows.filter(row => {
    // Must have a due date
    if (!row.dueDate) {
      excludedCount++;
      return false;
    }
    
    // Must have positive liability (a charge, not a payment/credit)
    if (row.liability === null || row.liability <= 0) {
      excludedCount++;
      return false;
    }
    
    // Exclude payment codes if identifiable
    if (row.code === 'PMT' || row.code === 'PAY' || row.code === 'CRD' || row.code === 'REF') {
      excludedCount++;
      if (!exclusionReasons.includes(`Excluded code: ${row.code}`)) {
        exclusionReasons.push(`Excluded code: ${row.code}`);
      }
      return false;
    }
    
    return true;
  });
  
  if (excludedCount > 0 && exclusionReasons.length === 0) {
    exclusionReasons.push(`Excluded ${excludedCount} rows with no due_date or non-positive sum_liab`);
  }
  
  return { billRows, excludedCount, exclusionReasons };
}

// Compute latest bill from bill rows
function computeLatestBill(billRows: LedgerRow[]): {
  latestDueDate: Date | null;
  latestDueDateStr: string | null;
  latestBillAmount: number | null;
  latestPeriodBalance: number | null;
  paymentStatus: PaymentStatus;
  rowsInLatestPeriod: number;
} {
  if (billRows.length === 0) {
    return {
      latestDueDate: null,
      latestDueDateStr: null,
      latestBillAmount: null,
      latestPeriodBalance: null,
      paymentStatus: 'unknown',
      rowsInLatestPeriod: 0,
    };
  }
  
  // Find max due date
  let maxDate: Date | null = null;
  for (const row of billRows) {
    if (row.dueDate && (!maxDate || row.dueDate > maxDate)) {
      maxDate = row.dueDate;
    }
  }
  
  if (!maxDate) {
    return {
      latestDueDate: null,
      latestDueDateStr: null,
      latestBillAmount: null,
      latestPeriodBalance: null,
      paymentStatus: 'unknown',
      rowsInLatestPeriod: 0,
    };
  }
  
  // Filter to rows with the latest due date (compare by date string to handle time differences)
  const maxDateStr = maxDate.toISOString().split('T')[0];
  const latestPeriodRows = billRows.filter(row => {
    if (!row.dueDate) return false;
    return row.dueDate.toISOString().split('T')[0] === maxDateStr;
  });
  
  // Sum liability for latest period (this is the bill amount)
  let totalLiability = 0;
  let totalBalance = 0;
  let hasValidBalance = false;
  
  for (const row of latestPeriodRows) {
    if (row.liability !== null && row.liability > 0) {
      totalLiability += row.liability;
    }
    if (row.balance !== null) {
      totalBalance += row.balance;
      hasValidBalance = true;
    }
  }
  
  // Round to cents
  totalLiability = Math.round(totalLiability * 100) / 100;
  totalBalance = Math.round(totalBalance * 100) / 100;
  
  // Determine payment status
  let paymentStatus: PaymentStatus = 'unknown';
  if (hasValidBalance) {
    if (totalBalance <= 0.01) { // Allow for small rounding errors
      paymentStatus = 'paid';
    } else {
      paymentStatus = 'unpaid';
    }
  }
  
  return {
    latestDueDate: maxDate,
    latestDueDateStr: formatDateDisplay(maxDate),
    latestBillAmount: totalLiability > 0 ? totalLiability : null,
    latestPeriodBalance: hasValidBalance ? totalBalance : null,
    paymentStatus,
    rowsInLatestPeriod: latestPeriodRows.length,
  };
}

// Compute arrears (past-due positive balances)
function computeArrears(rows: LedgerRow[], latestDueDate: Date | null): {
  arrears: number | null;
  arrearsAvailable: boolean;
  arrearsNote: string;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Filter to rows with due_date < today (past due)
  // and with positive balance
  let totalArrears = 0;
  let hasArrearsData = false;
  let pastDueRowCount = 0;
  
  for (const row of rows) {
    if (!row.dueDate) continue;
    
    // Skip if this is the latest period (not arrears)
    if (latestDueDate && row.dueDate.toISOString().split('T')[0] === latestDueDate.toISOString().split('T')[0]) {
      continue;
    }
    
    // Only consider rows with due_date < today
    if (row.dueDate >= today) continue;
    
    pastDueRowCount++;
    
    // Sum positive balances (amounts still owed)
    if (row.balance !== null && row.balance > 0) {
      totalArrears += row.balance;
      hasArrearsData = true;
    }
  }
  
  if (!hasArrearsData) {
    if (pastDueRowCount === 0) {
      return {
        arrears: 0,
        arrearsAvailable: true,
        arrearsNote: 'No past-due periods found',
      };
    }
    return {
      arrears: null,
      arrearsAvailable: false,
      arrearsNote: 'Balance data unavailable for past periods',
    };
  }
  
  totalArrears = Math.round(totalArrears * 100) / 100;
  
  if (totalArrears <= 0.01) {
    return {
      arrears: 0,
      arrearsAvailable: true,
      arrearsNote: 'All past periods paid',
    };
  }
  
  return {
    arrears: totalArrears,
    arrearsAvailable: true,
    arrearsNote: `Sum of positive balances from ${pastDueRowCount} past-due periods`,
  };
}

// Query NYC Open Data
async function queryByFieldAndKey(
  field: string,
  key: string,
  appToken: string
): Promise<{ rows: RawRow[]; url: string; error?: string }> {
  const whereClause = `${field}='${key}'`;
  const url = `${BASE_URL}?$limit=500&$where=${encodeURIComponent(whereClause)}&$order=due_date DESC`;
  
  console.log(`[property-taxes] Query: ${field}='${key}'`);
  
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  
  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[property-taxes] API error: ${response.status}`);
      return { rows: [], url, error: `API ${response.status}: ${errorBody.substring(0, 200)}` };
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      return { rows: [], url, error: 'Unexpected response format' };
    }
    
    console.log(`[property-taxes] ${field}='${key}' returned ${data.length} rows`);
    return { rows: data as RawRow[], url };
    
  } catch (fetchError) {
    const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`[property-taxes] Fetch error: ${errMsg}`);
    return { rows: [], url, error: `Network error: ${errMsg}` };
  }
}

// Multi-key lookup
async function fetchLedgerRows(bbl: string, appToken: string): Promise<{
  rows: RawRow[];
  matchedField: string | null;
  matchedKey: string | null;
  url: string;
  error: string | null;
}> {
  const candidateKeys = generateCandidateKeys(bbl);
  const fieldsToTry = ['parid', 'bble', 'bbl'];
  
  for (const key of candidateKeys) {
    for (const field of fieldsToTry) {
      const result = await queryByFieldAndKey(field, key, appToken);
      
      if (result.rows.length > 0) {
        return {
          rows: result.rows,
          matchedField: field,
          matchedKey: key,
          url: result.url,
          error: null,
        };
      }
    }
  }
  
  return {
    rows: [],
    matchedField: null,
    matchedKey: null,
    url: `${BASE_URL}?parid=${bbl}`,
    error: 'No data found after trying multiple identifier formats',
  };
}

interface TaxResult {
  // Primary outputs
  latest_bill_amount: number | null;
  latest_due_date: string | null;
  billing_cycle: BillingCycle;
  billing_cycle_evidence: string;
  
  // Payment status
  payment_status: PaymentStatus;
  latest_period_balance: number | null;
  
  // Arrears
  arrears: number | null;
  arrears_available: boolean;
  arrears_note: string;
  
  // Metadata
  bbl_used: string;
  matched_field: string | null;
  matched_key: string | null;
  total_rows_fetched: number;
  bill_rows_used: number;
  rows_excluded: number;
  exclusion_reasons: string[];
  rows_in_latest_period: number;
  data_source: string;
  no_data_found: boolean;
  cache_status: 'HIT' | 'MISS';
  cached_at: string | null;
  
  // Debug (only when debug=true)
  debug?: {
    request_url: string;
    fields_used: {
      due_date: string[];
      liability: string[];
      balance: string[];
      code: string[];
    };
    first_row_keys: string[];
    sample_rows: Array<{
      due_date: string | null;
      liability: number | null;
      balance: number | null;
      code: string | null;
    }>;
    all_due_dates: string[];
    computation_log: string[];
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const debugFromQuery = url.searchParams.get('debug') === 'true' || url.searchParams.get('debug') === '1';
    
    const { bbl, building_bbl, view_bbl, debug: debugFromBody } = await req.json();
    const includeDebug = debugFromQuery || debugFromBody === true || debugFromBody === 1 || debugFromBody === '1';
    
    const viewBbl = view_bbl || bbl;
    const primaryBbl = building_bbl || viewBbl;
    
    console.log(`[property-taxes] Request - view_bbl: ${viewBbl}, building_bbl: ${building_bbl || 'none'}, primary: ${primaryBbl}, debug: ${includeDebug}`);
    
    if (!viewBbl || viewBbl.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Invalid BBL format. Expected 10 digits.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    const normalizedBbl = normalizeBbl(primaryBbl);
    
    // Check cache (skip if debug mode)
    const cacheKey = `v5:ledger:${normalizedBbl}`;
    if (!includeDebug) {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        console.log(`[property-taxes] Cache HIT for ${cacheKey}`);
        return new Response(
          JSON.stringify({
            ...(cached.data as object),
            cache_status: 'HIT',
            cached_at: new Date(cached.timestamp).toISOString(),
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    const computationLog: string[] = [];
    
    // Fetch ledger rows
    computationLog.push('Fetching ledger rows from DOF Property Charges Balance...');
    const fetchResult = await fetchLedgerRows(normalizedBbl, appToken);
    computationLog.push(`Fetched ${fetchResult.rows.length} rows`);
    
    if (fetchResult.rows.length === 0) {
      // No data found
      const result: TaxResult = {
        latest_bill_amount: null,
        latest_due_date: null,
        billing_cycle: 'Unknown',
        billing_cycle_evidence: 'No data available',
        payment_status: 'unknown',
        latest_period_balance: null,
        arrears: null,
        arrears_available: false,
        arrears_note: 'No ledger data available',
        bbl_used: normalizedBbl,
        matched_field: null,
        matched_key: null,
        total_rows_fetched: 0,
        bill_rows_used: 0,
        rows_excluded: 0,
        exclusion_reasons: [],
        rows_in_latest_period: 0,
        data_source: `NYC Open Data DOF Property Charges (${DATASET_ID})`,
        no_data_found: true,
        cache_status: 'MISS',
        cached_at: null,
      };
      
      if (includeDebug) {
        result.debug = {
          request_url: fetchResult.url,
          fields_used: {
            due_date: DUE_DATE_FIELDS,
            liability: LIABILITY_FIELDS,
            balance: BALANCE_FIELDS,
            code: CODE_FIELDS,
          },
          first_row_keys: [],
          sample_rows: [],
          all_due_dates: [],
          computation_log: [...computationLog, 'No data found'],
        };
      }
      
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Parse all rows
    computationLog.push('Parsing rows...');
    const parsedRows = fetchResult.rows.map(parseRow);
    
    // Get first row keys for debug
    const firstRowKeys = Object.keys(fetchResult.rows[0]).sort();
    computationLog.push(`First row keys: ${firstRowKeys.slice(0, 10).join(', ')}...`);
    
    // Infer billing cycle
    computationLog.push('Inferring billing cycle from due date patterns...');
    const { cycle: billingCycle, evidence: billingCycleEvidence } = inferBillingCycle(parsedRows);
    computationLog.push(`Billing cycle: ${billingCycle} (${billingCycleEvidence})`);
    
    // Filter to bill rows
    computationLog.push('Filtering to bill charge rows (sum_liab > 0, has due_date)...');
    const { billRows, excludedCount, exclusionReasons } = filterBillRows(parsedRows);
    computationLog.push(`Found ${billRows.length} bill rows, excluded ${excludedCount} rows`);
    
    // Compute latest bill
    computationLog.push('Computing latest bill...');
    const latestBillResult = computeLatestBill(billRows);
    computationLog.push(`Latest due date: ${latestBillResult.latestDueDateStr || 'none'}`);
    computationLog.push(`Latest bill amount: $${latestBillResult.latestBillAmount?.toLocaleString() || 'null'}`);
    computationLog.push(`Latest period balance: $${latestBillResult.latestPeriodBalance?.toLocaleString() || 'null'}`);
    computationLog.push(`Payment status: ${latestBillResult.paymentStatus}`);
    
    // Compute arrears
    computationLog.push('Computing arrears from past-due periods...');
    const arrearsResult = computeArrears(parsedRows, latestBillResult.latestDueDate);
    computationLog.push(`Arrears: ${arrearsResult.arrearsAvailable ? `$${arrearsResult.arrears?.toLocaleString() || '0'}` : 'unavailable'}`);
    computationLog.push(`Arrears note: ${arrearsResult.arrearsNote}`);
    
    // Collect all unique due dates for debug
    const allDueDates = [...new Set(parsedRows
      .filter(r => r.dueDateStr)
      .map(r => r.dueDateStr!)
    )].sort().reverse();
    
    // Build result
    const result: TaxResult = {
      latest_bill_amount: latestBillResult.latestBillAmount,
      latest_due_date: latestBillResult.latestDueDateStr,
      billing_cycle: billingCycle,
      billing_cycle_evidence: billingCycleEvidence,
      payment_status: latestBillResult.paymentStatus,
      latest_period_balance: latestBillResult.latestPeriodBalance,
      arrears: arrearsResult.arrears,
      arrears_available: arrearsResult.arrearsAvailable,
      arrears_note: arrearsResult.arrearsNote,
      bbl_used: normalizedBbl,
      matched_field: fetchResult.matchedField,
      matched_key: fetchResult.matchedKey,
      total_rows_fetched: fetchResult.rows.length,
      bill_rows_used: billRows.length,
      rows_excluded: excludedCount,
      exclusion_reasons: exclusionReasons,
      rows_in_latest_period: latestBillResult.rowsInLatestPeriod,
      data_source: `NYC Open Data DOF Property Charges (${DATASET_ID})`,
      no_data_found: false,
      cache_status: 'MISS',
      cached_at: null,
    };
    
    if (includeDebug) {
      result.debug = {
        request_url: fetchResult.url,
        fields_used: {
          due_date: DUE_DATE_FIELDS,
          liability: LIABILITY_FIELDS,
          balance: BALANCE_FIELDS,
          code: CODE_FIELDS,
        },
        first_row_keys: firstRowKeys,
        sample_rows: parsedRows.slice(0, 10).map(r => ({
          due_date: r.dueDateStr,
          liability: r.liability,
          balance: r.balance,
          code: r.code,
        })),
        all_due_dates: allDueDates.slice(0, 20),
        computation_log: computationLog,
      };
    }
    
    // Cache result
    const now = Date.now();
    cache.set(cacheKey, { data: result, timestamp: now });
    
    console.log(`[property-taxes] Result - bill: $${result.latest_bill_amount}, due: ${result.latest_due_date}, status: ${result.payment_status}, cycle: ${result.billing_cycle}`);
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch tax data';
    console.error('[property-taxes] Unhandled error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
