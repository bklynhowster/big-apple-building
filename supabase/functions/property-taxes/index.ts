import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// In-memory cache with 6-hour TTL
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// NYC Open Data DOF Property Charges Balance dataset
const DATASET_ID = 'scjx-j6np';

interface ChargeRow {
  parid?: string;
  stmtdate?: string;
  activitythrough?: string;
  value?: string;
  dession?: string;
  chargetype?: string;
  install?: string;
  tax_year?: string;
  borough?: string;
  block?: string;
  lot?: string;
  [key: string]: unknown;
}

interface TaxResult {
  current_balance_due: number;
  most_recent_bill_period: string | null;
  most_recent_due_date: string | null;
  last_payment_date: string | null;
  line_items: ChargeRow[];
  scope: 'unit' | 'building' | 'direct';
  parid_used: string;
  data_as_of: string | null;
  no_data_found?: boolean;
}

// Convert BBL to PARID (BBL + easement "0")
function bblToParid(bbl: string): string {
  // BBL is 10 digits: Borough(1) + Block(5) + Lot(4)
  // PARID is 11 chars: Borough(1) + Block(5) + Lot(4) + Easement(1)
  return bbl.padStart(10, '0') + '0';
}

// Query the DOF dataset for a given PARID
async function queryDOFCharges(parid: string, appToken: string): Promise<{ rows: ChargeRow[]; error?: string }> {
  // Use simple query format: ?parid=VALUE&$limit=200
  // Avoid $order and $where until we confirm the API works
  const url = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json?parid=${encodeURIComponent(parid)}&$limit=200`;
  
  console.log(`[property-taxes] Request URL: ${url}`);
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  
  if (appToken) {
    headers['X-App-Token'] = appToken;
  }
  
  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      // Get the full error body for diagnostics
      const errorBody = await response.text();
      console.error(`[property-taxes] DOF API error: ${response.status} ${response.statusText}`);
      console.error(`[property-taxes] Error body: ${errorBody}`);
      return { 
        rows: [], 
        error: `DOF API returned ${response.status}: ${errorBody.substring(0, 500)}` 
      };
    }
    
    const data = await response.json();
    
    // Validate response is an array
    if (!Array.isArray(data)) {
      console.error(`[property-taxes] Unexpected response type: ${typeof data}`);
      return { rows: [], error: 'Unexpected response format from DOF API' };
    }
    
    console.log(`[property-taxes] DOF returned ${data.length} rows for PARID ${parid}`);
    
    // Sort by statement date descending (since we removed $order)
    const sorted = data.sort((a: ChargeRow, b: ChargeRow) => {
      const dateA = a.stmtdate || '';
      const dateB = b.stmtdate || '';
      return dateB.localeCompare(dateA);
    });
    
    return { rows: sorted as ChargeRow[] };
  } catch (fetchError) {
    const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error(`[property-taxes] Fetch error: ${errMsg}`);
    return { rows: [], error: `Network error: ${errMsg}` };
  }
}

// Process charge rows into a summary
function processCharges(rows: ChargeRow[], scope: 'unit' | 'building' | 'direct', paridUsed: string): TaxResult {
  if (rows.length === 0) {
    return {
      current_balance_due: 0,
      most_recent_bill_period: null,
      most_recent_due_date: null,
      last_payment_date: null,
      line_items: [],
      scope,
      parid_used: paridUsed,
      data_as_of: null,
      no_data_found: true,
    };
  }
  
  // Calculate current balance due - sum all charge values
  // In DOF data, positive values are charges, negative are payments/credits
  let totalBalance = 0;
  for (const row of rows) {
    const value = parseFloat(row.value || '0');
    if (!isNaN(value)) {
      totalBalance += value;
    }
  }
  
  // Get most recent statement date as "bill period"
  const mostRecentRow = rows[0]; // Already sorted DESC
  const mostRecentBillPeriod = mostRecentRow?.stmtdate ?? null;
  const mostRecentDueDate = mostRecentRow?.activitythrough ?? null;
  
  // Find most recent payment (negative value)
  const payments = rows.filter(r => parseFloat(r.value || '0') < 0);
  const lastPaymentDate = payments.length > 0 ? (payments[0].stmtdate ?? null) : null;
  
  // Data as of - use the most recent activity date
  const dataAsOf = mostRecentRow?.activitythrough ?? mostRecentRow?.stmtdate ?? null;
  
  return {
    current_balance_due: Math.round(totalBalance * 100) / 100, // Round to cents
    most_recent_bill_period: mostRecentBillPeriod,
    most_recent_due_date: mostRecentDueDate,
    last_payment_date: lastPaymentDate,
    line_items: rows.slice(0, 20), // Limit to 20 for UI
    scope,
    parid_used: paridUsed,
    data_as_of: dataAsOf,
    no_data_found: false,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bbl, building_bbl } = await req.json();
    
    console.log(`[property-taxes] Request received - bbl: ${bbl}, building_bbl: ${building_bbl || 'none'}`);
    
    if (!bbl || bbl.length !== 10) {
      return new Response(
        JSON.stringify({ error: 'Invalid BBL format. Expected 10 digits.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    
    // Derive PARIDs
    const unitParid = bblToParid(bbl);
    const buildingParid = building_bbl ? bblToParid(building_bbl) : null;
    
    console.log(`[property-taxes] Derived PARIDs - unit: ${unitParid}, building: ${buildingParid || 'none'}`);
    
    // Check cache first for unit PARID
    const cacheKey = unitParid;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[property-taxes] Cache hit for PARID ${unitParid}`);
      return new Response(
        JSON.stringify(cached.data),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Query for unit PARID first
    let queryResult = await queryDOFCharges(unitParid, appToken);
    let rows = queryResult.rows;
    let scope: 'unit' | 'building' | 'direct' = 'direct';
    let paridUsed = unitParid;
    let lastError = queryResult.error;
    
    // If no rows and we have a building BBL, try building PARID
    if (rows.length === 0 && buildingParid && buildingParid !== unitParid) {
      console.log(`[property-taxes] No rows for unit PARID, trying building PARID: ${buildingParid}`);
      
      // Check building cache
      const buildingCacheKey = buildingParid;
      const buildingCached = cache.get(buildingCacheKey);
      if (buildingCached && Date.now() - buildingCached.timestamp < CACHE_TTL_MS) {
        console.log(`[property-taxes] Cache hit for building PARID ${buildingParid}`);
        const result = { ...buildingCached.data as TaxResult, scope: 'building' as const };
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      queryResult = await queryDOFCharges(buildingParid, appToken);
      rows = queryResult.rows;
      scope = 'building';
      paridUsed = buildingParid;
      if (queryResult.error) {
        lastError = queryResult.error;
      }
    } else if (rows.length > 0 && building_bbl) {
      // We found unit-level data
      scope = 'unit';
    }
    
    // If we still have no rows and there was an error, report it
    if (rows.length === 0 && lastError) {
      console.error(`[property-taxes] Final error after fallback: ${lastError}`);
      // Return empty result instead of throwing - graceful degradation
      const emptyResult: TaxResult = {
        current_balance_due: 0,
        most_recent_bill_period: null,
        most_recent_due_date: null,
        last_payment_date: null,
        line_items: [],
        scope,
        parid_used: paridUsed,
        data_as_of: null,
        no_data_found: true,
      };
      return new Response(
        JSON.stringify({ ...emptyResult, api_error: lastError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Process the results
    const result = processCharges(rows, scope, paridUsed);
    
    // Cache the result (even empty results to avoid repeated calls)
    cache.set(paridUsed, { data: result, timestamp: Date.now() });
    
    console.log(`[property-taxes] Returning result - scope: ${scope}, balance: ${result.current_balance_due}, rows: ${result.line_items.length}, no_data: ${result.no_data_found}`);
    
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
