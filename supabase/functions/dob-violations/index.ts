import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data DOB Violations dataset
const NYC_OPEN_DATA_BASE = 'https://data.cityofnewyork.us/resource/3h2n-5cm9.json';
const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

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

interface ApiResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: ViolationRecord[];
  nextOffset: number | null;
}

function validateBBL(bbl: string): boolean {
  return /^\d{10}$/.test(bbl);
}

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  // NYC Open Data dates can be in various formats
  try {
    // Try parsing as ISO format first
    if (dateStr.includes('T')) {
      return new Date(dateStr).toISOString().split('T')[0];
    }
    // Try MM/DD/YYYY format
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [month, day, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    // Try YYYYMMDD format
    if (/^\d{8}$/.test(dateStr)) {
      return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

function normalizeViolation(raw: Record<string, unknown>): ViolationRecord {
  const dispositionDate = parseDateToISO(raw.disposition_date as string);
  const dispositionComments = (raw.disposition_comments as string || '').toLowerCase();
  
  // Determine status based on disposition
  let status: 'open' | 'resolved' | 'unknown' = 'unknown';
  if (dispositionDate) {
    // If there's a disposition date, it's likely resolved
    if (dispositionComments.includes('dismissed') || 
        dispositionComments.includes('complied') || 
        dispositionComments.includes('resolved') ||
        dispositionComments.includes('vacated') ||
        dispositionComments.includes('cured')) {
      status = 'resolved';
    } else if (dispositionComments.includes('pending') || 
               dispositionComments.includes('open')) {
      status = 'open';
    } else {
      status = 'resolved'; // Default to resolved if there's a disposition date
    }
  } else {
    status = 'open'; // No disposition date means likely open
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
    limit = Math.min(Math.max(1, limit), 200); // Cap at 200

    let offset = parseInt(params.get('offset') || '0', 10);
    offset = Math.max(0, offset);

    // Parse filter params
    const fromDate = params.get('fromDate');
    const toDate = params.get('toDate');
    const status = params.get('status') || 'all';
    const keyword = params.get('q');

    console.log(`=== DOB Violations Request ===`);
    console.log(`BBL received: ${bbl}`);
    console.log(`Parsed: boro=${boro}, block=${block}, lot=${lot}`);

    // Build SoQL query - the dataset uses separate boro, block, lot fields (not combined bbl)
    const whereConditions: string[] = [];
    
    // Filter by boro, block, lot (without leading zeros for matching)
    whereConditions.push(`boro='${boro}'`);
    whereConditions.push(`block='${block.replace(/^0+/, '') || '0'}'`);
    whereConditions.push(`lot='${lot.replace(/^0+/, '') || '0'}'`);

    // Date filtering
    if (fromDate) {
      whereConditions.push(`issue_date >= '${fromDate}'`);
    }
    if (toDate) {
      whereConditions.push(`issue_date <= '${toDate}'`);
    }

    // Keyword search on description
    if (keyword) {
      const escapedKeyword = keyword.replace(/'/g, "''");
      whereConditions.push(`upper(description) like upper('%${escapedKeyword}%')`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Build API URL for data
    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit + 1)); // Fetch one extra to check for more
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
    let items = dataToProcess.map(normalizeViolation);

    // Apply status filter (client-side since API doesn't have direct status field)
    if (status === 'open') {
      items = items.filter(item => item.status === 'open');
    } else if (status === 'resolved') {
      items = items.filter(item => item.status === 'resolved');
    }

    // Get approximate count - try a count query
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
      // Fall back to estimate
      if (hasMore) {
        totalApprox = offset + limit + 1; // At least one more page
      }
    }

    const response: ApiResponse = {
      source: 'DOB Violations',
      bbl,
      totalApprox,
      items,
      nextOffset: hasMore ? offset + limit : null,
    };

    console.log(`Returning ${items.length} normalized records, total approx: ${totalApprox}`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in dob-violations function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
