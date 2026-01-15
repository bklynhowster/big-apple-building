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
  current_amount_owed: number | null;  // null means "not available" (no rows)
  rows_count: number;
  as_of: string | null;
  recent_rows: ChargeRow[];
  scope_used: 'unit' | 'building' | 'direct';
  parid_used: string;
  bbl_used: string;
  no_data_found: boolean;
  api_error?: string;
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
    
    // Sort by statement date descending (newest first)
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
function processCharges(rows: ChargeRow[], scope: 'unit' | 'building' | 'direct', paridUsed: string, bblUsed: string): TaxResult {
  // If no rows, return explicit "no data found" - do NOT return $0
  if (rows.length === 0) {
    return {
      current_amount_owed: null,  // null = "not available", NOT $0
      rows_count: 0,
      as_of: null,
      recent_rows: [],
      scope_used: scope,
      parid_used: paridUsed,
      bbl_used: bblUsed,
      no_data_found: true,
    };
  }
  
  // Calculate current amount owed - sum all open/unpaid balances
  // In DOF data, the "value" field represents the charge/credit amount
  // Positive values are charges owed, negative are payments/credits
  let totalOwed = 0;
  for (const row of rows) {
    const value = parseFloat(row.value || '0');
    if (!isNaN(value)) {
      totalOwed += value;
    }
  }
  
  // Round to cents
  totalOwed = Math.round(totalOwed * 100) / 100;
  
  // Get the most recent date as "as_of"
  const mostRecentRow = rows[0]; // Already sorted DESC
  const asOf = mostRecentRow?.activitythrough || mostRecentRow?.stmtdate || null;
  
  console.log(`[property-taxes] Processed ${rows.length} rows, computed balance: ${totalOwed}, as_of: ${asOf}`);
  
  return {
    current_amount_owed: totalOwed,
    rows_count: rows.length,
    as_of: asOf,
    recent_rows: rows.slice(0, 25), // Limit to 25 for UI
    scope_used: scope,
    parid_used: paridUsed,
    bbl_used: bblUsed,
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
    
    // Normalize field names (accept both view_bbl and bbl)
    const viewBbl = bbl;
    const buildingBbl = building_bbl;
    
    console.log(`[property-taxes] Request received - view_bbl: ${viewBbl}, building_bbl: ${buildingBbl || 'none'}`);
    
    if (!viewBbl || viewBbl.length !== 10) {
      return new Response(
        JSON.stringify({ error: 'Invalid BBL format. Expected 10 digits.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    
    // Derive PARIDs
    const unitParid = bblToParid(viewBbl);
    const buildingParid = buildingBbl ? bblToParid(buildingBbl) : null;
    
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
    let bblUsed = viewBbl;
    let lastError = queryResult.error;
    
    // If no rows and we have a building BBL, try building PARID
    if (rows.length === 0 && buildingParid && buildingParid !== unitParid) {
      console.log(`[property-taxes] No rows for unit PARID, trying building PARID: ${buildingParid}`);
      
      // Check building cache
      const buildingCacheKey = buildingParid;
      const buildingCached = cache.get(buildingCacheKey);
      if (buildingCached && Date.now() - buildingCached.timestamp < CACHE_TTL_MS) {
        console.log(`[property-taxes] Cache hit for building PARID ${buildingParid}`);
        const cachedResult = buildingCached.data as TaxResult;
        const result = { ...cachedResult, scope_used: 'building' as const };
        return new Response(
          JSON.stringify(result),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      queryResult = await queryDOFCharges(buildingParid, appToken);
      rows = queryResult.rows;
      scope = 'building';
      paridUsed = buildingParid;
      bblUsed = buildingBbl;
      if (queryResult.error) {
        lastError = queryResult.error;
      }
    } else if (rows.length > 0 && buildingBbl) {
      // We found unit-level data
      scope = 'unit';
    }
    
    // Process the results
    const result = processCharges(rows, scope, paridUsed, bblUsed);
    
    // Add API error info if present (but still return the result)
    if (lastError && rows.length === 0) {
      result.api_error = lastError;
    }
    
    // Cache the result (even empty results to avoid repeated calls)
    cache.set(paridUsed, { data: result, timestamp: Date.now() });
    
    console.log(`[property-taxes] Returning result - scope: ${result.scope_used}, amount_owed: ${result.current_amount_owed}, rows_count: ${result.rows_count}, no_data: ${result.no_data_found}`);
    
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
