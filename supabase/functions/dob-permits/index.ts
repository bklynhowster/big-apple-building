import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data DOB Permit Issuance dataset
const NYC_OPEN_DATA_BASE = 'https://data.cityofnewyork.us/resource/ipu4-2q9a.json';
const DATASET_NAME = 'DOB Permit Issuance (ipu4-2q9a)';
const NYC_OPEN_DATA_APP_TOKEN = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN');

interface PermitRecord {
  recordType: string;
  recordId: string;
  status: 'open' | 'closed' | 'unknown';
  issueDate: string | null;
  resolvedDate: string | null;
  expirationDate: string | null;
  category: string | null;
  description: string | null;
  jobNumber: string | null;
  permitType: string | null;
  workType: string | null;
  applicantName: string | null;
  ownerName: string | null;
  raw: Record<string, unknown>;
}

interface ApiResponse {
  source: string;
  bbl: string;
  totalApprox: number;
  items: PermitRecord[];
  nextOffset: number | null;
}

function validateBBL(bbl: string): boolean {
  return /^\d{10}$/.test(bbl);
}

function parseDateToISO(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  try {
    // Handle MM/DD/YYYY format (common in this dataset)
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const [month, day, year] = parts;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }
    // Handle ISO format
    if (dateStr.includes('T') || dateStr.includes('-')) {
      return new Date(dateStr).toISOString().split('T')[0];
    }
    // Handle YYYYMMDD format
    if (/^\d{8}$/.test(dateStr)) {
      return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

// Map borough name to code
const BOROUGH_TO_CODE: Record<string, string> = {
  'MANHATTAN': '1',
  'BRONX': '2',
  'BROOKLYN': '3',
  'QUEENS': '4',
  'STATEN ISLAND': '5',
};

function normalizePermit(raw: Record<string, unknown>): PermitRecord {
  const permitStatus = (raw.permit_status as string || '').toUpperCase();
  
  // Determine status based on permit_status field
  let status: 'open' | 'closed' | 'unknown' = 'unknown';
  if (permitStatus === 'ISSUED' || permitStatus === 'IN PROCESS' || permitStatus === 'PENDING') {
    status = 'open';
  } else if (permitStatus === 'SIGNED OFF' || permitStatus === 'COMPLETED' || permitStatus === 'EXPIRED') {
    status = 'closed';
  }

  // Build applicant name
  const permitteeFirst = raw.permittee_s_first_name as string || '';
  const permitteeLast = raw.permittee_s_last_name as string || '';
  const permitteeBusiness = raw.permittee_s_business_name as string || '';
  const applicantName = permitteeBusiness || `${permitteeFirst} ${permitteeLast}`.trim() || null;

  // Build owner name
  const ownerFirst = raw.owner_s_first_name as string || '';
  const ownerLast = raw.owner_s_last_name as string || '';
  const ownerBusiness = raw.owner_s_business_name as string || '';
  const ownerName = ownerBusiness || `${ownerFirst} ${ownerLast}`.trim() || null;

  // Build description from work type and permit type
  const workType = raw.work_type as string || '';
  const jobType = raw.job_type as string || '';
  const permitType = raw.permit_type as string || '';
  const description = [workType, jobType].filter(Boolean).join(' - ') || null;

  return {
    recordType: 'Permit',
    recordId: raw.job__ as string || raw.permit_si_no as string || 'Unknown',
    status,
    issueDate: parseDateToISO(raw.issuance_date as string),
    resolvedDate: null, // Dataset doesn't have a clear resolved date
    expirationDate: parseDateToISO(raw.expiration_date as string),
    category: permitType || jobType || null,
    description,
    jobNumber: raw.job__ as string || null,
    permitType: permitType || null,
    workType: workType || null,
    applicantName,
    ownerName,
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

    // Map boro code to borough name for this dataset
    const boroughNames: Record<string, string> = {
      '1': 'MANHATTAN',
      '2': 'BRONX',
      '3': 'BROOKLYN',
      '4': 'QUEENS',
      '5': 'STATEN ISLAND',
    };
    const boroughName = boroughNames[boro] || 'MANHATTAN';

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

    console.log(`=== DOB Permits Request ===`);
    console.log(`Dataset: ${DATASET_NAME}`);
    console.log(`BBL received: ${bbl}`);
    
    // Build SoQL query
    // This dataset uses borough name, block (5 digits with leading zeros), lot (5 digits with leading zeros)
    const whereConditions: string[] = [];
    
    // Pad lot to 5 digits for this dataset (it uses 5-digit lot format)
    const paddedLot = lot.padStart(5, '0');
    
    console.log(`Parsed: borough=${boroughName}, block=${block}, lot=${paddedLot}`);
    
    whereConditions.push(`borough='${boroughName}'`);
    whereConditions.push(`block='${block}'`);
    whereConditions.push(`lot='${paddedLot}'`);

    // Date filtering on issuance_date (MM/DD/YYYY format in dataset)
    if (fromDate) {
      whereConditions.push(`issuance_date >= '${fromDate}'`);
    }
    if (toDate) {
      whereConditions.push(`issuance_date <= '${toDate}'`);
    }

    // Status filtering
    if (status === 'open') {
      whereConditions.push(`(permit_status='ISSUED' OR permit_status='IN PROCESS' OR permit_status='PENDING')`);
    } else if (status === 'closed') {
      whereConditions.push(`(permit_status='SIGNED OFF' OR permit_status='COMPLETED' OR permit_status='EXPIRED')`);
    }

    // Keyword search across multiple fields
    if (keyword) {
      const escapedKeyword = keyword.replace(/'/g, "''");
      whereConditions.push(`(
        upper(permit_type) like upper('%${escapedKeyword}%') OR
        upper(work_type) like upper('%${escapedKeyword}%') OR
        upper(job_type) like upper('%${escapedKeyword}%') OR
        upper(permittee_s_business_name) like upper('%${escapedKeyword}%') OR
        upper(owner_s_business_name) like upper('%${escapedKeyword}%')
      )`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Build API URL for data
    const dataUrl = new URL(NYC_OPEN_DATA_BASE);
    dataUrl.searchParams.set('$where', whereClause);
    dataUrl.searchParams.set('$limit', String(limit + 1));
    dataUrl.searchParams.set('$offset', String(offset));
    dataUrl.searchParams.set('$order', 'issuance_date DESC');

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
    const items = dataToProcess.map(normalizePermit);

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
      source: 'DOB Permits',
      bbl,
      totalApprox,
      items,
      nextOffset: hasMore ? offset + limit : null,
    };

    console.log(`Returning ${items.length} normalized permit records, total approx: ${totalApprox}`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in dob-permits function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
