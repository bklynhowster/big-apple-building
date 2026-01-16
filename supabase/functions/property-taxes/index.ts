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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

// Normalize date to ISO YYYY-MM-DD string or null
function normDate(d: unknown): string | null {
  if (!d) return null;
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Robust numeric parsing - handles "$1,234.56", "1,234.56", "-1,234.56", etc.
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return null;
  // Remove currency symbols and commas
  const cleaned = s.replace(/[$,]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Generate a period key for grouping duplicate rows
function periodKey(r: NormalizedRow): string {
  // Prefer explicit year/period fields if present; fallback to due_date only.
  const due = r.due_date ?? '';
  const y = r.tax_year ?? '';
  const p = r.year_period ?? '';
  const charge = r.code ?? '';
  return [y, p, due, charge].join('|');
}

// Format date for display (MM/DD/YYYY)
function formatDateDisplay(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

// ============================================================================
// TYPES
// ============================================================================

// Raw row from NYC Open Data
interface RawRow {
  [key: string]: unknown;
}

// Normalized row with consistent types
interface NormalizedRow {
  raw: RawRow;
  due_date: string | null;
  sum_liab: number | null;
  sum_bal: number | null;
  code: string;
  tax_year: string | null;
  year_period: string | null;
}

// Period aggregation bucket
interface PeriodAgg {
  key: string;
  due_date: string | null;
  max_liab: number;   // canonical bill for that period
  max_bal: number;    // canonical balance for that period
  row_count: number;
  sample_codes: string[];
}

// ============================================================================
// DATA NORMALIZATION
// ============================================================================

// Field candidates for extraction
const DUE_DATE_FIELDS = ['due_date', 'dt_pd_begin', 'dt_pd_end', 'stmtdate', 'bill_date', 'effective_date'];
const LIABILITY_FIELDS = ['sum_liab', 'amount', 'charge_amount', 'original_amount', 'billed_amount'];
const BALANCE_FIELDS = ['sum_bal', 'open_balance', 'outstanding_amount', 'outstanding_balance', 'balance'];
const CODE_FIELDS = ['code', 'type', 'charge_type', 'chargetype'];
const TAX_YEAR_FIELDS = ['tax_year', 'year', 'fiscal_year'];
const PERIOD_FIELDS = ['year_period', 'period', 'tax_period'];

// Get first matching field value
function getFieldValue(row: RawRow, candidates: string[]): unknown {
  for (const field of candidates) {
    const val = row[field];
    if (val !== undefined && val !== null && val !== '') {
      return val;
    }
  }
  return null;
}

// Normalize raw rows to consistent shape
function normalizeRows(rawRows: RawRow[]): NormalizedRow[] {
  return rawRows.map(r => ({
    raw: r,
    due_date: normDate(getFieldValue(r, DUE_DATE_FIELDS)),
    sum_liab: toNumber(getFieldValue(r, LIABILITY_FIELDS)),
    sum_bal: toNumber(getFieldValue(r, BALANCE_FIELDS)),
    code: String(getFieldValue(r, CODE_FIELDS) ?? '').trim().toUpperCase(),
    tax_year: getFieldValue(r, TAX_YEAR_FIELDS) ? String(getFieldValue(r, TAX_YEAR_FIELDS)) : null,
    year_period: getFieldValue(r, PERIOD_FIELDS) ? String(getFieldValue(r, PERIOD_FIELDS)) : null,
  }));
}

// ============================================================================
// PERIOD BUCKETING - KEY FIX FOR INFLATED AMOUNTS
// ============================================================================

function buildPeriodBuckets(rows: NormalizedRow[]): PeriodAgg[] {
  const buckets = new Map<string, PeriodAgg>();
  
  for (const r of rows) {
    if (!r.due_date) continue;
    
    const k = periodKey(r);
    const liab = r.sum_liab ?? 0;
    const bal = r.sum_bal ?? 0;
    
    const cur = buckets.get(k) ?? {
      key: k,
      due_date: r.due_date,
      max_liab: 0,
      max_bal: 0,
      row_count: 0,
      sample_codes: [],
    };
    
    cur.row_count += 1;
    // Use MAX instead of SUM to avoid duplicate inflation
    cur.max_liab = Math.max(cur.max_liab, liab);
    cur.max_bal = Math.max(cur.max_bal, bal);
    
    if (r.code && cur.sample_codes.length < 6 && !cur.sample_codes.includes(r.code)) {
      cur.sample_codes.push(r.code);
    }
    
    buckets.set(k, cur);
  }
  
  // Sort by due_date ascending
  return Array.from(buckets.values()).sort((a, b) =>
    (a.due_date ?? '').localeCompare(b.due_date ?? '')
  );
}

// ============================================================================
// BILLING CYCLE INFERENCE
// ============================================================================

function inferBillingCycle(periods: PeriodAgg[]): { cycle: BillingCycle; evidence: string } {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0];
  
  // Get unique due date months from last 12 months
  const recentPeriods = periods.filter(p => p.due_date && p.due_date >= oneYearAgoStr);
  const uniqueMonths = new Set<number>();
  
  for (const period of recentPeriods) {
    if (period.due_date) {
      const month = parseInt(period.due_date.slice(5, 7), 10) - 1; // 0-indexed
      uniqueMonths.add(month);
    }
  }
  
  const monthsArray = Array.from(uniqueMonths).sort((a, b) => a - b);
  
  // Quarterly pattern: Jan(0), Apr(3), Jul(6), Oct(9)
  // Semiannual pattern: Jan(0), Jul(6)
  const quarterlyMonths = [0, 3, 6, 9];
  const semiannualMonths = [0, 6];
  
  const matchedQuarterly = monthsArray.filter(m => quarterlyMonths.includes(m));
  const matchedSemiannual = monthsArray.filter(m => semiannualMonths.includes(m));
  
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  
  if (matchedQuarterly.length >= 3) {
    return { 
      cycle: 'Quarterly', 
      evidence: `Found ${matchedQuarterly.length} quarterly due date months: ${monthsArray.map(m => monthNames[m]).join(', ')}`
    };
  }
  
  if (matchedSemiannual.length === 2 && monthsArray.length <= 3) {
    return { 
      cycle: 'Semiannual', 
      evidence: `Found semiannual pattern: ${monthsArray.map(m => monthNames[m]).join(', ')}`
    };
  }
  
  if (uniqueMonths.size === 0) {
    return { cycle: 'Unknown', evidence: 'No due dates found in last 12 months' };
  }
  
  return { 
    cycle: 'Unknown', 
    evidence: `Inconclusive pattern: months found = ${monthsArray.map(m => monthNames[m]).join(', ')}`
  };
}

// ============================================================================
// LATEST BILL COMPUTATION
// ============================================================================

interface LatestBillResult {
  latestDueDate: string | null;
  latestDueDateDisplay: string | null;
  latestBillAmount: number | null;
  latestPeriodBalance: number | null;
  paymentStatus: PaymentStatus;
  latestPeriodKey: string | null;
  rowsInLatestPeriod: number;
}

function computeLatestBill(periods: PeriodAgg[]): LatestBillResult {
  if (periods.length === 0) {
    return {
      latestDueDate: null,
      latestDueDateDisplay: null,
      latestBillAmount: null,
      latestPeriodBalance: null,
      paymentStatus: 'unknown',
      latestPeriodKey: null,
      rowsInLatestPeriod: 0,
    };
  }
  
  // Find max due_date
  const latestDue = periods[periods.length - 1].due_date;
  
  // Get all periods with the latest due date (there may be multiple keys for different charge types)
  const latestCandidates = periods.filter(p => p.due_date === latestDue);
  
  // Pick the one with highest max_liab (the main tax bill)
  const latest = latestCandidates.sort((a, b) => b.max_liab - a.max_liab)[0];
  
  if (!latest || !latest.due_date) {
    return {
      latestDueDate: null,
      latestDueDateDisplay: null,
      latestBillAmount: null,
      latestPeriodBalance: null,
      paymentStatus: 'unknown',
      latestPeriodKey: null,
      rowsInLatestPeriod: 0,
    };
  }
  
  const latestBillAmount = latest.max_liab > 0 ? Math.round(latest.max_liab * 100) / 100 : null;
  const latestPeriodBalance = Math.round(latest.max_bal * 100) / 100;
  
  // Determine payment status
  let paymentStatus: PaymentStatus = 'unknown';
  if (latest.max_bal <= 0.01) {
    paymentStatus = 'paid';
  } else if (latest.max_bal > 0) {
    paymentStatus = 'unpaid';
  }
  
  return {
    latestDueDate: latest.due_date,
    latestDueDateDisplay: formatDateDisplay(latest.due_date),
    latestBillAmount,
    latestPeriodBalance,
    paymentStatus,
    latestPeriodKey: latest.key,
    rowsInLatestPeriod: latest.row_count,
  };
}

// ============================================================================
// ARREARS COMPUTATION - DETERMINISTIC WITH LATEST PERIOD EXCLUSION
// Proper date parsing - no string comparisons for date logic
// ============================================================================

interface ArrearsResult {
  arrears: number | null;
  arrearsAvailable: boolean;
  arrearsNote: string;
  runningBalanceDetected: boolean;
  // Enhanced debug info for ?debug=1
  debugInfo: {
    today: string;
    latestDueDate: string | null;
    latestPeriodBalance: number | null;
    maxPriorBalance: number | null;
    arreasFinal: number;
    runningBalanceDetected: boolean;
    periodsConsidered: number;
    periodsIncludedInArrears: string[]; // list of due_dates included
    exclusionReason?: string;
  };
}

// Parse ISO date string to Date object
function parseDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : d;
}

// Check if date A < date B using proper Date comparison
function isDateBefore(a: string | null, b: string | null): boolean {
  const dateA = parseDate(a);
  const dateB = parseDate(b);
  if (!dateA || !dateB) return false;
  return dateA.getTime() < dateB.getTime();
}

// Check if two dates are the same day
function isSameDate(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a === b; // Both are ISO YYYY-MM-DD strings
}

function computeArrears(
  periods: PeriodAgg[], 
  latestDueDate: string | null,
  latestPeriodBalance: number | null,
  latestBillAmount: number | null
): ArrearsResult {
  // Get today in YYYY-MM-DD format (UTC)
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const todayDate = parseDate(today)!;
  const latestDate = parseDate(latestDueDate);
  
  console.log(`[computeArrears] today=${today}, latestDueDate=${latestDueDate}, latestPeriodBalance=${latestPeriodBalance}, latestBillAmount=${latestBillAmount}, periods=${periods.length}`);
  
  // ARREARS RULES - CONSERVATIVE APPROACH:
  // 1. due_date must exist
  // 2. max_bal > 0 (has outstanding balance)
  // 3. due_date < today (past the due date) - using proper date parsing
  // 4. due_date != latestDueDate (NEVER include the latest billing period)
  // 5. Arrears = 0 if the only unpaid balance is the current bill
  
  const periodsIncludedInArrears: string[] = [];
  
  // Get all periods BEFORE the latest one that might have balances
  const priorPeriods = periods.filter(p => {
    if (!p.due_date) return false;
    
    const periodDate = parseDate(p.due_date);
    if (!periodDate) return false;
    
    // Rule 4: ALWAYS exclude the latest period (by date comparison)
    if (latestDueDate && isSameDate(p.due_date, latestDueDate)) {
      console.log(`[computeArrears] Excluding latest period: ${p.due_date}`);
      return false;
    }
    
    // Rule 3: Only include periods before today (proper date comparison)
    if (periodDate.getTime() >= todayDate.getTime()) {
      console.log(`[computeArrears] Excluding future/current period: ${p.due_date} >= ${today}`);
      return false;
    }
    
    return true;
  });
  
  // Get past-due periods with positive balance
  const pastDue = priorPeriods.filter(p => {
    if (p.max_bal <= 0) {
      console.log(`[computeArrears] Period ${p.due_date} has zero/negative balance: ${p.max_bal}`);
      return false;
    }
    
    console.log(`[computeArrears] Prior period with balance: ${p.due_date} balance=${p.max_bal}`);
    periodsIncludedInArrears.push(p.due_date!);
    return true;
  });
  
  console.log(`[computeArrears] Past-due periods with balance: ${pastDue.length}`);
  
  // If no prior periods have balance, arrears = 0
  if (pastDue.length === 0) {
    return {
      arrears: 0,
      arrearsAvailable: true,
      arrearsNote: 'No past-due balances (current period excluded)',
      runningBalanceDetected: false,
      debugInfo: {
        today,
        latestDueDate,
        latestPeriodBalance,
        maxPriorBalance: null,
        arreasFinal: 0,
        runningBalanceDetected: false,
        periodsConsidered: periods.length,
        periodsIncludedInArrears: [],
        exclusionReason: 'No prior periods with positive balance',
      },
    };
  }
  
  const pastBalances = pastDue.map(p => p.max_bal);
  const maxPriorBalance = Math.max(...pastBalances);
  const minPriorBalance = Math.min(...pastBalances);
  
  // DETECT RUNNING BALANCE PATTERN:
  // 1. All periods have similar balances (within 30% of each other)
  // 2. OR balances are monotonically stable/increasing
  // 3. OR the max prior balance is close to the current period balance
  let runningLikely = false;
  let runningBalanceReason = '';
  
  // Check 1: Similar balances across periods
  if (pastBalances.length >= 2 && maxPriorBalance > 0) {
    const variance = (maxPriorBalance - minPriorBalance) / maxPriorBalance;
    if (variance < 0.3) {
      runningLikely = true;
      runningBalanceReason = `Similar balances across ${pastBalances.length} periods (variance=${(variance*100).toFixed(0)}%)`;
    }
  }
  
  // Check 2: Monotonically stable/increasing (running balance behavior)
  if (!runningLikely && pastBalances.length >= 3) {
    let stableCount = 0;
    for (let i = 1; i < pastBalances.length; i++) {
      if (pastBalances[i] >= pastBalances[i - 1] * 0.9) stableCount++;
    }
    if (stableCount / (pastBalances.length - 1) > 0.7) {
      runningLikely = true;
      runningBalanceReason = `Stable/increasing pattern (${stableCount} of ${pastBalances.length - 1} transitions)`;
    }
  }
  
  // Check 3: Max prior balance matches current period balance (strong signal)
  if (!runningLikely && latestPeriodBalance !== null && latestPeriodBalance > 0) {
    const diff = Math.abs(maxPriorBalance - latestPeriodBalance);
    const tolerance = Math.max(latestPeriodBalance * 0.15, 50); // 15% or $50
    if (diff <= tolerance) {
      runningLikely = true;
      runningBalanceReason = `Prior max balance matches current (diff=${formatCurrency(diff)})`;
    }
  }
  
  // Check 4: All prior balances match the current bill amount (classic running balance)
  if (!runningLikely && latestBillAmount !== null && latestBillAmount > 0) {
    const matchingBillCount = pastBalances.filter(b => 
      Math.abs(b - latestBillAmount) < latestBillAmount * 0.1 // Within 10%
    ).length;
    if (matchingBillCount === pastBalances.length) {
      runningLikely = true;
      runningBalanceReason = 'All prior balances match current bill amount';
    }
  }
  
  console.log(`[computeArrears] Running balance detection: ${runningLikely} (${runningBalanceReason || 'discrete periods'})`);
  
  let arrearsAmount: number;
  let arrearsNote: string;
  
  if (runningLikely) {
    // RUNNING BALANCE SYSTEM:
    // The balance shown in prior periods is cumulative. To find true arrears:
    // - If max prior balance <= current period balance: Arrears = 0 (just reflecting current bill)
    // - If max prior balance > current period balance: Arrears = difference
    
    if (latestPeriodBalance !== null && latestPeriodBalance > 0) {
      const delta = maxPriorBalance - latestPeriodBalance;
      
      if (delta <= 0.01) {
        // Prior balance is same or less than current - no arrears
        arrearsAmount = 0;
        arrearsNote = `Running balance: prior periods show current bill (${runningBalanceReason})`;
      } else {
        // Prior balance exceeds current - that's true arrears
        arrearsAmount = delta;
        arrearsNote = `Prior balance exceeds current by ${formatCurrency(delta)} (${runningBalanceReason})`;
      }
    } else if (latestBillAmount !== null && latestBillAmount > 0) {
      // No current period balance, but we have the bill amount
      const delta = maxPriorBalance - latestBillAmount;
      
      if (delta <= 0.01) {
        arrearsAmount = 0;
        arrearsNote = `Running balance matches bill amount (${runningBalanceReason})`;
      } else {
        arrearsAmount = delta;
        arrearsNote = `Prior balance exceeds bill by ${formatCurrency(delta)} (${runningBalanceReason})`;
      }
    } else {
      // No reference point - be conservative, assume running balance = 0 arrears
      arrearsAmount = 0;
      arrearsNote = `Running balance detected but no reference (${runningBalanceReason})`;
    }
  } else {
    // DISCRETE PERIODS: Each period's balance is independent
    // Sum all past-due balances
    arrearsAmount = pastBalances.reduce((s, v) => s + v, 0);
    arrearsNote = `Sum of ${pastBalances.length} past-due period balances`;
  }
  
  arrearsAmount = Math.round(arrearsAmount * 100) / 100;
  
  if (arrearsAmount <= 0.01) {
    return {
      arrears: 0,
      arrearsAvailable: true,
      arrearsNote: runningLikely ? arrearsNote : 'No past-due balances',
      runningBalanceDetected: runningLikely,
      debugInfo: {
        today,
        latestDueDate,
        latestPeriodBalance,
        maxPriorBalance,
        arreasFinal: 0,
        runningBalanceDetected: runningLikely,
        periodsConsidered: periods.length,
        periodsIncludedInArrears,
        exclusionReason: runningLikely ? runningBalanceReason : 'All prior balances paid',
      },
    };
  }
  
  return {
    arrears: arrearsAmount,
    arrearsAvailable: true,
    arrearsNote,
    runningBalanceDetected: runningLikely,
    debugInfo: {
      today,
      latestDueDate,
      latestPeriodBalance,
      maxPriorBalance,
      arreasFinal: arrearsAmount,
      runningBalanceDetected: runningLikely,
      periodsConsidered: periods.length,
      periodsIncludedInArrears,
    },
  };
}

// Helper for formatting currency in logs
function formatCurrency(n: number): string {
  return `$${n.toFixed(2)}`;
}

// ============================================================================
// NYC OPEN DATA QUERY
// ============================================================================

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

// ============================================================================
// RESULT TYPE
// ============================================================================

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
  period_count: number;
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
      tax_year: string[];
      period: string[];
    };
    first_row_keys: string[];
    running_balance_detected: boolean;
    latest_period_key: string | null;
    latest_due_date_raw: string | null; // ISO format for debugging
    periods: Array<{
      due_date: string | null;
      max_liab: number;
      max_bal: number;
      row_count: number;
      codes: string[];
    }>;
    computation_log: string[];
    // Enhanced arrears debug
    arrears_debug: {
      today: string;
      latest_due_date: string | null;
      latest_period_balance: number | null;
      max_prior_balance: number | null;
      arrears_final: number;
      running_balance_detected: boolean;
      periods_considered: number;
      periods_included_in_arrears: string[];
      exclusion_reason?: string;
    };
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

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
    // CRITICAL: No automatic fallback to building_bbl
    // The frontend is responsible for context-aware querying:
    // - Unit pages should pass only the unit BBL
    // - Building pages should pass the billing BBL directly
    // This prevents context leak where unit pages inherit building tax data
    const primaryBbl = viewBbl;
    
    console.log(`[property-taxes] Request - view_bbl: ${viewBbl}, building_bbl: ${building_bbl || 'none (ignored)'}, primary: ${primaryBbl}, debug: ${includeDebug}`);
    
    if (!viewBbl || viewBbl.length < 8) {
      return new Response(
        JSON.stringify({ error: 'Invalid BBL format. Expected 10 digits.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    const normalizedBbl = normalizeBbl(primaryBbl);
    
    // Check cache (skip if debug mode)
    const cacheKey = `v6:periods:${normalizedBbl}`;
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
    computationLog.push(`Fetched ${fetchResult.rows.length} raw rows`);
    
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
        period_count: 0,
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
            tax_year: TAX_YEAR_FIELDS,
            period: PERIOD_FIELDS,
          },
          first_row_keys: [],
          running_balance_detected: false,
          latest_period_key: null,
          latest_due_date_raw: null,
          periods: [],
          computation_log: [...computationLog, 'No data found'],
          arrears_debug: {
            today: new Date().toISOString().slice(0, 10),
            latest_due_date: null,
            latest_period_balance: null,
            max_prior_balance: null,
            arrears_final: 0,
            running_balance_detected: false,
            periods_considered: 0,
            periods_included_in_arrears: [],
            exclusion_reason: 'No data available',
          },
        };
      }
      
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Get first row keys for debug
    const firstRowKeys = Object.keys(fetchResult.rows[0]).sort();
    computationLog.push(`First row keys: ${firstRowKeys.slice(0, 10).join(', ')}...`);
    
    // Normalize rows
    computationLog.push('Normalizing rows to consistent shape...');
    const normalizedRows = normalizeRows(fetchResult.rows);
    
    // Build period buckets (KEY FIX: group by period, take MAX not SUM)
    computationLog.push('Building period buckets (grouping by tax_year|period|due_date|code)...');
    const periods = buildPeriodBuckets(normalizedRows);
    computationLog.push(`Created ${periods.length} unique period buckets from ${fetchResult.rows.length} raw rows`);
    
    // Infer billing cycle
    computationLog.push('Inferring billing cycle from due date patterns...');
    const { cycle: billingCycle, evidence: billingCycleEvidence } = inferBillingCycle(periods);
    computationLog.push(`Billing cycle: ${billingCycle} (${billingCycleEvidence})`);
    
    // Compute latest bill from periods
    computationLog.push('Computing latest bill from period buckets...');
    const latestBillResult = computeLatestBill(periods);
    computationLog.push(`Latest due date: ${latestBillResult.latestDueDateDisplay || 'none'}`);
    computationLog.push(`Latest bill amount (canonical): $${latestBillResult.latestBillAmount?.toLocaleString() || 'null'}`);
    computationLog.push(`Latest period balance: $${latestBillResult.latestPeriodBalance?.toLocaleString() || 'null'}`);
    computationLog.push(`Payment status: ${latestBillResult.paymentStatus}`);
    
    // Compute arrears - CRITICAL: pass the raw ISO date and latest period balance
    computationLog.push('Computing arrears from past-due periods...');
    computationLog.push(`latestDueDate (raw ISO): ${latestBillResult.latestDueDate || 'null'}`);
    computationLog.push(`latestPeriodBalance: ${latestBillResult.latestPeriodBalance}`);
    const arrearsResult = computeArrears(periods, latestBillResult.latestDueDate, latestBillResult.latestPeriodBalance, latestBillResult.latestBillAmount);
    computationLog.push(`Arrears debug: today=${arrearsResult.debugInfo.today}, latestDueDate=${arrearsResult.debugInfo.latestDueDate}, maxPriorBalance=${arrearsResult.debugInfo.maxPriorBalance}`);
    computationLog.push(`Periods considered: ${arrearsResult.debugInfo.periodsConsidered}, included in arrears calc: ${arrearsResult.debugInfo.periodsIncludedInArrears.length}`);
    computationLog.push(`Running balance detected: ${arrearsResult.runningBalanceDetected}`);
    computationLog.push(`Arrears: ${arrearsResult.arrearsAvailable ? `$${arrearsResult.arrears?.toLocaleString() || '0'}` : 'unavailable'}`);
    computationLog.push(`Arrears note: ${arrearsResult.arrearsNote}`);
    
    // Build result
    const result: TaxResult = {
      latest_bill_amount: latestBillResult.latestBillAmount,
      latest_due_date: latestBillResult.latestDueDateDisplay,
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
      period_count: periods.length,
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
          tax_year: TAX_YEAR_FIELDS,
          period: PERIOD_FIELDS,
        },
        first_row_keys: firstRowKeys,
        running_balance_detected: arrearsResult.runningBalanceDetected,
        latest_period_key: latestBillResult.latestPeriodKey,
        latest_due_date_raw: latestBillResult.latestDueDate,
        periods: periods.slice(-15).map(p => ({
          due_date: p.due_date,
          max_liab: Math.round(p.max_liab * 100) / 100,
          max_bal: Math.round(p.max_bal * 100) / 100,
          row_count: p.row_count,
          codes: p.sample_codes,
        })),
        computation_log: computationLog,
        arrears_debug: {
          today: arrearsResult.debugInfo.today,
          latest_due_date: arrearsResult.debugInfo.latestDueDate,
          latest_period_balance: arrearsResult.debugInfo.latestPeriodBalance,
          max_prior_balance: arrearsResult.debugInfo.maxPriorBalance,
          arrears_final: arrearsResult.debugInfo.arreasFinal,
          running_balance_detected: arrearsResult.debugInfo.runningBalanceDetected,
          periods_considered: arrearsResult.debugInfo.periodsConsidered,
          periods_included_in_arrears: arrearsResult.debugInfo.periodsIncludedInArrears,
          exclusion_reason: arrearsResult.debugInfo.exclusionReason,
        },
      };
    }
    
    // Cache result
    const now = Date.now();
    cache.set(cacheKey, { data: result, timestamp: now });
    
    console.log(`[property-taxes] Result - bill: $${result.latest_bill_amount}, due: ${result.latest_due_date}, status: ${result.payment_status}, periods: ${result.period_count}`);
    
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
