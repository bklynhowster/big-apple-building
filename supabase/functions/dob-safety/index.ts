import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// DOB Safety violations dataset - using DOB Violations (3h2n-5cm9) filtered by violation_category
// This dataset includes safety-related violations with BBL field
const DATASET_ID = '3h2n-5cm9';
const DATASET_NAME = 'DOB Violations (Safety filtered)';
const BASE_URL = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`;

interface SafetyViolation {
  recordType: 'Safety';
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  category: string | null;
  description: string | null;
  raw: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const bbl = url.searchParams.get('bbl');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const fromDate = url.searchParams.get('fromDate');
    const toDate = url.searchParams.get('toDate');
    const status = url.searchParams.get('status') || 'all';

    if (!bbl || bbl.length !== 10) {
      return new Response(
        JSON.stringify({ error: 'Valid 10-digit BBL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse BBL into components
    const boro = bbl.charAt(0);
    const block = bbl.slice(1, 6);
    const lot = bbl.slice(6, 10);

    console.log(`Dataset: ${DATASET_NAME} (${DATASET_ID})`);
    console.log(`BBL received: ${bbl} (boro=${boro}, block=${block}, lot=${lot})`);

    // Build SoQL query for safety-related violations
    // Filter by violation_category containing safety-related terms
    const whereClauses: string[] = [
      `boro = '${boro}'`,
      `block = '${block}'`,
      `lot = '${lot}'`,
      // Filter for safety-related violations
      `(violation_category LIKE '%SAFETY%' OR violation_category LIKE '%HAZARD%' OR violation_category LIKE '%UNSAFE%' OR violation_type LIKE '%SAFETY%' OR violation_type LIKE '%HAZARD%' OR ecb_violation_status IS NOT NULL)`,
    ];

    // Date filtering on issue_date
    if (fromDate) {
      whereClauses.push(`issue_date >= '${fromDate}T00:00:00'`);
    }
    if (toDate) {
      whereClauses.push(`issue_date <= '${toDate}T23:59:59'`);
    }

    // Status filtering based on violation_status or disposition_date
    if (status === 'open') {
      whereClauses.push(`(violation_status != 'CLOSED' OR violation_status IS NULL) AND disposition_date IS NULL`);
    } else if (status === 'closed') {
      whereClauses.push(`(violation_status = 'CLOSED' OR disposition_date IS NOT NULL)`);
    }

    const whereClause = whereClauses.join(' AND ');
    const soqlQuery = `$where=${encodeURIComponent(whereClause)}&$order=issue_date DESC&$limit=${limit}&$offset=${offset}`;
    
    console.log(`SoQL query: ${whereClause}`);

    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (appToken) {
      headers['X-App-Token'] = appToken;
    }

    const response = await fetch(`${BASE_URL}?${soqlQuery}`, { headers });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`NYC Open Data error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch safety data', details: errorText }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawData = await response.json();
    console.log(`Row count: ${rawData.length}`);

    // Normalize items
    const items: SafetyViolation[] = rawData.map((row: Record<string, unknown>) => {
      // Determine status
      let itemStatus: 'open' | 'closed' | 'unknown' = 'unknown';
      const violationStatus = (row.violation_status as string || '').toUpperCase();
      const dispositionDate = row.disposition_date as string | null;
      
      if (violationStatus === 'CLOSED' || dispositionDate) {
        itemStatus = 'closed';
      } else if (violationStatus === 'OPEN' || violationStatus === 'ACTIVE' || !dispositionDate) {
        itemStatus = 'open';
      }

      return {
        recordType: 'Safety' as const,
        recordId: (row.violation_number as string) || (row.number as string) || `${row.isn_dob_bis_extract || 'unknown'}`,
        status: itemStatus,
        issueDate: (row.issue_date as string) || null,
        resolvedDate: dispositionDate || null,
        category: (row.violation_category as string) || (row.violation_type as string) || null,
        description: (row.description as string) || (row.violation_type_code as string) || null,
        raw: row,
      };
    });

    // Get approximate total count
    const countQuery = `$where=${encodeURIComponent(whereClause)}&$select=count(*) as total`;
    let totalApprox = items.length;
    
    try {
      const countResponse = await fetch(`${BASE_URL}?${countQuery}`, { headers });
      if (countResponse.ok) {
        const countData = await countResponse.json();
        if (countData[0]?.total) {
          totalApprox = parseInt(countData[0].total);
        }
      }
    } catch (e) {
      console.log('Count query failed, using items length');
    }

    const result = {
      source: 'DOB Safety Violations',
      bbl,
      totalApprox,
      items,
      nextOffset: items.length === limit ? offset + limit : null,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in dob-safety function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
