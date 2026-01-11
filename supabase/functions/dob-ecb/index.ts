import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data DOB ECB Violations dataset
const NYC_OPEN_DATA_BASE = 'https://data.cityofnewyork.us/resource/6bgk-3dad.json';
const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

interface ECBRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'resolved' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  penaltyAmount: number | null;
  amountPaid: number | null;
  balanceDue: number | null;
  severity: string | null;
  raw: Record<string, unknown>;
}

interface ApiResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: ECBRecord[];
  nextOffset: number | null;
}

function validateBBL(bbl: string): boolean {
  return /^\d{10}$/.test(bbl);
}

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  try {
    // Handle YYYYMMDD format (common in this dataset)
    if (/^\d{8}$/.test(dateStr)) {
      return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }
    // Handle ISO format
    if (dateStr.includes('T')) {
      return new Date(dateStr).toISOString().split('T')[0];
    }
    // Handle MM/DD/YYYY format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [month, day, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

function normalizeECBViolation(raw: Record<string, unknown>): ECBRecord {
  const ecbStatus = (raw.ecb_violation_status as string || '').toUpperCase();
  const hearingStatus = (raw.hearing_status as string || '').toUpperCase();
  
  // Determine status based on ecb_violation_status and hearing_status
  let status: 'open' | 'resolved' | 'unknown' = 'unknown';
  if (ecbStatus === 'RESOLVE' || ecbStatus === 'RESOLVED') {
    status = 'resolved';
  } else if (ecbStatus === 'OPEN' || ecbStatus === 'ACTIVE') {
    status = 'open';
  } else if (hearingStatus.includes('VIOLATION') || hearingStatus.includes('DEFAULT')) {
    // In violation or default usually means still open/pending
    const balanceDue = parseFloat(raw.balance_due as string || '0');
    status = balanceDue > 0 ? 'open' : 'resolved';
  } else if (hearingStatus.includes('DISMISSED')) {
    status = 'resolved';
  }

  const penaltyImposed = raw.penality_imposed || raw.penalty_imposed;
  
  return {
    recordType: 'ECB',
    recordId: raw.ecb_violation_number as string || raw.dob_violation_number as string || 'Unknown',
    status,
    issueDate: parseDateToISO(raw.issue_date as string),
    resolvedDate: null, // Dataset doesn't have a clear resolved date
    category: raw.violation_type as string || raw.infraction_code1 as string || null,
    description: raw.violation_description as string || raw.section_law_description1 as string || null,
    penaltyAmount: penaltyImposed ? parseFloat(penaltyImposed as string) : null,
    amountPaid: raw.amount_paid ? parseFloat(raw.amount_paid as string) : null,
    balanceDue: raw.balance_due ? parseFloat(raw.balance_due as string) : null,
    severity: raw.severity as string || null,
    raw,
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams;

    // Extract and validate parameters
    let bbl = params.get('bbl');
    if (!bbl) {
      return new Response(
        JSON.stringify({ error: 'bbl parameter is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize BBL to 10 digits
    bbl = bbl.toString().padStart(10, '0');

    if (!validateBBL(bbl)) {
      return new Response(
        JSON.stringify({ error: 'bbl must be exactly 10 digits', received: bbl }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse BBL into components for the query
    const boro = bbl.charAt(0);
    const block = bbl.slice(1, 6);
    const lot = bbl.slice(6, 10);

    // Parse pagination params
    let limit = parseInt(params.get('limit') || '50', 10);
    limit = Math.min(Math.max(1, limit), 200);

    let offset = parseInt(params.get('offset') || '0', 10);
    offset = Math.max(0, offset);

    // Parse filter params
    const fromDate = params.get('fromDate');
    const toDate = params.get('toDate');
    const status = params.get('status') || 'all';
    const keyword = params.get('q');

    console.log(`=== DOB ECB Violations Request ===`);
    console.log(`BBL received: ${bbl}`);
    console.log(`Parsed: boro=${boro}, block=${block}, lot=${lot}`);

    // Build SoQL query - the dataset uses separate boro, block, lot fields
    const whereConditions: string[] = [];
    
    // Filter by boro, block, lot (ECB dataset uses padded values with leading zeros)
    whereConditions.push(`boro='${boro}'`);
    whereConditions.push(`block='${block}'`); // Keep leading zeros (5 digits)
    whereConditions.push(`lot='${lot}'`); // Keep leading zeros (4 digits)

    // Date filtering on issue_date
    if (fromDate) {
      // Convert YYYY-MM-DD to YYYYMMDD for comparison
      const fromDateFormatted = fromDate.replace(/-/g, '');
      whereConditions.push(`issue_date >= '${fromDateFormatted}'`);
    }
    if (toDate) {
      const toDateFormatted = toDate.replace(/-/g, '');
      whereConditions.push(`issue_date <= '${toDateFormatted}'`);
    }

    // Status filtering
    if (status === 'open') {
      whereConditions.push(`(ecb_violation_status='ACTIVE' OR ecb_violation_status='OPEN' OR balance_due > 0)`);
    } else if (status === 'resolved') {
      whereConditions.push(`ecb_violation_status='RESOLVE'`);
    }

    // Keyword search on violation_description
    if (keyword) {
      const escapedKeyword = keyword.replace(/'/g, "''");
      whereConditions.push(`upper(violation_description) like upper('%${escapedKeyword}%')`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Build API URL for data
    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    dataUrl.searchParams.set('$order', 'issue_date DESC');

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (NYC_OPEN_DATA_APP_TOKEN) {
      headers['X-App-Token'] = NYC_OPEN_DATA_APP_TOKEN;
    }

    const finalQueryUrl = dataUrl.toString();
    console.log(`SoQL query URL: ${finalQueryUrl}`);

    // Fetch data
    const dataResponse = await fetch(finalQueryUrl, { headers });
    if (!dataResponse.ok) {
      const errorText = await dataResponse.text();
      console.error(`NYC Open Data API error: ${dataResponse.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch from NYC Open Data',
          details: dataResponse.status === 429 ? 'Rate limit exceeded. Please try again later.' : errorText
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawData = await dataResponse.json() as Record<string, unknown>[];
    console.log(`Received ${rawData.length} raw records from NYC Open Data`);

    // Determine if there are more results
    const hasMore = rawData.length > limit;
    const dataToProcess = hasMore ? rawData.slice(0, limit) : rawData;

    // Normalize records
    const items = dataToProcess.map(normalizeECBViolation);

    // Get approximate count
    let totalApprox = items.length + offset;
    try {
      const countUrl = new URL(NYC_OPEN_DATA_BASE);
      countUrl.searchParams.set('$select', 'count(*)');
      countUrl.searchParams.set('$where', whereClause);
      
      const countResponse = await fetch(countUrl.toString(), { headers });
      if (countResponse.ok) {
        const countData = await countResponse.json();
        if (countData[0] && countData[0].count) {
          totalApprox = parseInt(countData[0].count, 10);
        }
      }
    } catch (countError) {
      console.error('Error fetching count:', countError);
      if (hasMore) {
        totalApprox = offset + limit + 1;
      }
    }

    const response: ApiResponse = {
      source: 'DOB ECB Violations',
      bbl,
      totalApprox,
      items,
      nextOffset: hasMore ? offset + limit : null,
    };

    console.log(`Returning ${items.length} normalized ECB records, total approx: ${totalApprox}`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in dob-ecb function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
