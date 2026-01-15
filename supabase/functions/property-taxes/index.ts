import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NYC Open Data datasets
const PLUTO_DATASET_ID = '64uk-42ks';
const PLUTO_BASE_URL = `https://data.cityofnewyork.us/resource/${PLUTO_DATASET_ID}.json`;

// DOF Assessment Roll dataset - primary source with billable assessed values
// https://data.cityofnewyork.us/dataset/Property-Valuation-and-Assessment-Data/yjxr-fw8i
const DOF_ASSESSMENT_DATASET_ID = 'yjxr-fw8i';
const DOF_ASSESSMENT_BASE_URL = `https://data.cityofnewyork.us/resource/${DOF_ASSESSMENT_DATASET_ID}.json`;

// NYC Tax Rates by Tax Class (FY 2024-25)
// Source: https://www.nyc.gov/site/finance/property/property-tax-rates.page
const NYC_TAX_RATES: Record<string, number> = {
  '1': 0.19963,   // Class 1: 1-3 family residential
  '2': 0.12235,   // Class 2: Multi-family residential
  '2A': 0.12235,  // Class 2A: 4-6 unit rentals
  '2B': 0.12235,  // Class 2B: 7-10 unit rentals
  '2C': 0.12235,  // Class 2C: 2-10 unit co-ops/condos
  '3': 0.11808,   // Class 3: Utility property
  '4': 0.10362,   // Class 4: Commercial property
};

// Basis types for tracking data source
type TaxBasis = 'dof_assessment' | 'pluto_estimate' | 'unavailable';
type TaxConfidence = 'high' | 'estimated' | 'none';
type ArrearsStatus = 'none_detected' | 'unavailable';

// Quarter due dates - NYC property tax is billed quarterly
// Q1: Jan 1, Q2: Apr 1, Q3: Jul 1, Q4: Oct 1
function getNextQuarterDueDate(): { quarter: number; dueDate: string; dueDateFormatted: string } {
  const now = new Date();
  const month = now.getMonth(); // 0-based
  const year = now.getFullYear();
  
  // Find the next upcoming due date
  const quarters = [
    { month: 0, day: 1, quarter: 1 },   // Jan 1
    { month: 3, day: 1, quarter: 2 },   // Apr 1
    { month: 6, day: 1, quarter: 3 },   // Jul 1
    { month: 9, day: 1, quarter: 4 },   // Oct 1
  ];
  
  for (const q of quarters) {
    const dueDate = new Date(year, q.month, q.day);
    if (dueDate > now) {
      const formatted = dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      return {
        quarter: q.quarter,
        dueDate: `${year}-${String(q.month + 1).padStart(2, '0')}-01`,
        dueDateFormatted: formatted,
      };
    }
  }
  
  // If past Oct 1, next due date is Jan 1 of next year
  const nextYear = year + 1;
  return {
    quarter: 1,
    dueDate: `${nextYear}-01-01`,
    dueDateFormatted: `January 1, ${nextYear}`,
  };
}

// In-memory cache
interface CacheEntry {
  data: unknown;
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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

// Get first matching field value from a row
function getFieldValue(row: Record<string, unknown>, candidates: string[]): string | number | null {
  for (const field of candidates) {
    const val = row[field];
    if (val !== undefined && val !== null && val !== '') {
      return typeof val === 'number' ? val : String(val);
    }
  }
  return null;
}

// Parse numeric value
function parseNumericValue(value: string | number | null): number | null {
  if (value === null) return null;
  const num = typeof value === 'number' ? value : parseFloat(value);
  return isNaN(num) ? null : num;
}

// Get tax rate for a tax class
function getTaxRate(taxClass: string | null): { rate: number | null; rateDescription: string } {
  if (!taxClass) {
    return { rate: null, rateDescription: 'Unknown tax class' };
  }
  
  const normalizedClass = taxClass.toUpperCase().trim();
  
  // Try exact match first
  if (NYC_TAX_RATES[normalizedClass]) {
    return { 
      rate: NYC_TAX_RATES[normalizedClass], 
      rateDescription: `Tax Class ${normalizedClass} (${(NYC_TAX_RATES[normalizedClass] * 100).toFixed(3)}%)` 
    };
  }
  
  // Try first character (e.g., "2A" -> "2")
  const baseClass = normalizedClass.charAt(0);
  if (NYC_TAX_RATES[baseClass]) {
    return { 
      rate: NYC_TAX_RATES[baseClass], 
      rateDescription: `Tax Class ${normalizedClass} (${(NYC_TAX_RATES[baseClass] * 100).toFixed(3)}%)` 
    };
  }
  
  return { rate: null, rateDescription: `Unknown tax class: ${taxClass}` };
}

interface TaxResult {
  // Primary outputs
  quarterly_bill: number | null;
  annual_tax: number | null;
  billing_cycle: string;
  due_date: string;
  due_date_formatted: string;
  
  // Data source tracking
  basis: TaxBasis;
  confidence: TaxConfidence;
  basis_explanation: string;
  
  // Assessment data used
  tax_class: string | null;
  tax_rate: number | null;
  tax_rate_description: string;
  assessed_value: number | null;
  exempt_value: number | null;
  taxable_billable_av: number | null;
  
  // Arrears (conservative)
  arrears: number | null;
  arrears_status: ArrearsStatus;
  arrears_note: string;
  
  // Metadata
  bbl_used: string;
  address: string | null;
  owner_name: string | null;
  building_class: string | null;
  data_source: string;
  no_data_found: boolean;
  cache_status: 'HIT' | 'MISS';
  cached_at: string | null;
  
  // Debug info (only when debug=true)
  debug?: {
    step1_attempted: boolean;
    step1_url: string | null;
    step1_success: boolean;
    step1_error: string | null;
    step2_attempted: boolean;
    step2_url: string | null;
    step2_success: boolean;
    step2_error: string | null;
    raw_dof_row: Record<string, unknown> | null;
    raw_pluto_row: Record<string, unknown> | null;
    dof_row_keys: string[];
    pluto_row_keys: string[];
    calculation_steps: string[];
  };
}

// DOF Assessment Roll field candidates
const DOF_FIELDS = {
  bbl: ['bbl', 'parid', 'boro_block_lot'],
  taxClass: ['tc', 'tax_class', 'taxclass', 'cur_tc', 'tntc'],
  billableAV: ['curavttxbt', 'cur_av_tot_txbl', 'billable_av', 'taxable_av', 'cav_tot_txbl'],
  assessedTotal: ['curavttot', 'cur_av_tot', 'assessed_total', 'assessed_value'],
  exemptTotal: ['curexttot', 'cur_ex_tot', 'exempt_total', 'exempttot'],
  annualTax: ['curtxbtot', 'cur_txb_tot', 'annual_tax', 'tax_amount'],
  address: ['staddr', 'address', 'addr', 'street_address'],
  ownerName: ['owner', 'ownername', 'owner_name'],
  buildingClass: ['bldg_cl', 'bldgclass', 'building_class'],
};

// PLUTO field candidates  
const PLUTO_FIELDS = {
  bbl: ['bbl'],
  taxClass: ['taxclass', 'tax_class', 'tc'],
  assessTotal: ['assesstot', 'assess_tot', 'assessedtotal', 'assessed_total'],
  assessLand: ['assessland', 'assess_land', 'assessedland'],
  exemptTotal: ['exempttot', 'exempt_tot', 'exemptedtotal'],
  address: ['address', 'addr'],
  ownerName: ['ownername', 'owner_name'],
  buildingClass: ['bldgclass', 'building_class', 'buildingclass'],
  landUse: ['landuse', 'land_use'],
};

// ============ STEP 1: DOF Assessment Roll ============

interface Step1Result {
  success: boolean;
  quarterlyBill: number | null;
  annualTax: number | null;
  taxClass: string | null;
  taxRate: number | null;
  taxRateDescription: string;
  billableAV: number | null;
  assessedValue: number | null;
  exemptValue: number | null;
  address: string | null;
  ownerName: string | null;
  buildingClass: string | null;
  url: string;
  error: string | null;
  row: Record<string, unknown> | null;
  steps: string[];
}

async function tryStep1DofAssessment(bbl: string, appToken: string): Promise<Step1Result> {
  const steps: string[] = [];
  steps.push('Step 1: Attempting DOF Assessment Roll lookup...');
  
  // Try different BBL formats
  const candidates = [bbl, bbl.replace(/^0+/, '')];
  
  for (const candidateBbl of [...new Set(candidates)]) {
    const url = `${DOF_ASSESSMENT_BASE_URL}?bbl=${candidateBbl}&$limit=1`;
    steps.push(`Trying DOF: bbl=${candidateBbl}`);
    
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (appToken) headers['X-App-Token'] = appToken;
    
    try {
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        steps.push(`DOF API error: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data) || data.length === 0) {
        steps.push('DOF returned no rows');
        continue;
      }
      
      const row = data[0] as Record<string, unknown>;
      steps.push(`DOF returned row with keys: ${Object.keys(row).slice(0, 10).join(', ')}...`);
      
      // Check if DOF provides annual_tax directly
      const annualTaxRaw = getFieldValue(row, DOF_FIELDS.annualTax);
      const annualTaxDirect = parseNumericValue(annualTaxRaw);
      
      if (annualTaxDirect !== null && annualTaxDirect > 0) {
        // DOF provides annual tax directly - use it!
        const quarterlyBill = Math.round(annualTaxDirect / 4 * 100) / 100;
        steps.push(`DOF provided annual_tax directly: $${annualTaxDirect.toLocaleString()}`);
        steps.push(`Quarterly Bill: $${annualTaxDirect.toLocaleString()} ÷ 4 = $${quarterlyBill.toLocaleString()}`);
        
        const taxClassRaw = getFieldValue(row, DOF_FIELDS.taxClass);
        const taxClass = taxClassRaw ? String(taxClassRaw) : null;
        const { rate, rateDescription } = getTaxRate(taxClass);
        
        const billableAVRaw = getFieldValue(row, DOF_FIELDS.billableAV);
        const billableAV = parseNumericValue(billableAVRaw);
        
        const assessedRaw = getFieldValue(row, DOF_FIELDS.assessedTotal);
        const assessedValue = parseNumericValue(assessedRaw);
        
        const exemptRaw = getFieldValue(row, DOF_FIELDS.exemptTotal);
        const exemptValue = parseNumericValue(exemptRaw) || 0;
        
        const addressRaw = getFieldValue(row, DOF_FIELDS.address);
        const ownerRaw = getFieldValue(row, DOF_FIELDS.ownerName);
        const bldgClassRaw = getFieldValue(row, DOF_FIELDS.buildingClass);
        
        return {
          success: true,
          quarterlyBill,
          annualTax: annualTaxDirect,
          taxClass,
          taxRate: rate,
          taxRateDescription: rateDescription,
          billableAV,
          assessedValue,
          exemptValue,
          address: addressRaw ? String(addressRaw) : null,
          ownerName: ownerRaw ? String(ownerRaw) : null,
          buildingClass: bldgClassRaw ? String(bldgClassRaw) : null,
          url,
          error: null,
          row,
          steps,
        };
      }
      
      // DOF doesn't have annual_tax, try billable AV + tax class
      const billableAVRaw = getFieldValue(row, DOF_FIELDS.billableAV);
      const billableAV = parseNumericValue(billableAVRaw);
      
      const taxClassRaw = getFieldValue(row, DOF_FIELDS.taxClass);
      const taxClass = taxClassRaw ? String(taxClassRaw) : null;
      
      if (billableAV !== null && billableAV > 0 && taxClass) {
        const { rate, rateDescription } = getTaxRate(taxClass);
        
        if (rate !== null) {
          const annualTax = Math.round(billableAV * rate * 100) / 100;
          const quarterlyBill = Math.round(annualTax / 4 * 100) / 100;
          
          steps.push(`DOF Billable AV: $${billableAV.toLocaleString()}`);
          steps.push(`Tax Class: ${taxClass}, Rate: ${(rate * 100).toFixed(3)}%`);
          steps.push(`Annual Tax: $${billableAV.toLocaleString()} × ${(rate * 100).toFixed(3)}% = $${annualTax.toLocaleString()}`);
          steps.push(`Quarterly Bill: $${annualTax.toLocaleString()} ÷ 4 = $${quarterlyBill.toLocaleString()}`);
          
          const assessedRaw = getFieldValue(row, DOF_FIELDS.assessedTotal);
          const assessedValue = parseNumericValue(assessedRaw);
          
          const exemptRaw = getFieldValue(row, DOF_FIELDS.exemptTotal);
          const exemptValue = parseNumericValue(exemptRaw) || 0;
          
          const addressRaw = getFieldValue(row, DOF_FIELDS.address);
          const ownerRaw = getFieldValue(row, DOF_FIELDS.ownerName);
          const bldgClassRaw = getFieldValue(row, DOF_FIELDS.buildingClass);
          
          return {
            success: true,
            quarterlyBill,
            annualTax,
            taxClass,
            taxRate: rate,
            taxRateDescription: rateDescription,
            billableAV,
            assessedValue,
            exemptValue,
            address: addressRaw ? String(addressRaw) : null,
            ownerName: ownerRaw ? String(ownerRaw) : null,
            buildingClass: bldgClassRaw ? String(bldgClassRaw) : null,
            url,
            error: null,
            row,
            steps,
          };
        }
      }
      
      steps.push('DOF row found but missing billable AV or tax class');
      
    } catch (error) {
      steps.push(`DOF fetch error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  steps.push('Step 1 failed: No usable DOF data found');
  
  return {
    success: false,
    quarterlyBill: null,
    annualTax: null,
    taxClass: null,
    taxRate: null,
    taxRateDescription: 'No data',
    billableAV: null,
    assessedValue: null,
    exemptValue: null,
    address: null,
    ownerName: null,
    buildingClass: null,
    url: `${DOF_ASSESSMENT_BASE_URL}?bbl=${bbl}`,
    error: 'No usable DOF assessment data',
    row: null,
    steps,
  };
}

// ============ STEP 2: PLUTO Fallback ============

interface Step2Result {
  success: boolean;
  quarterlyBill: number | null;
  annualTax: number | null;
  taxClass: string | null;
  taxRate: number | null;
  taxRateDescription: string;
  assessedValue: number | null;
  exemptValue: number | null;
  taxableValue: number | null;
  address: string | null;
  ownerName: string | null;
  buildingClass: string | null;
  url: string;
  error: string | null;
  row: Record<string, unknown> | null;
  steps: string[];
}

async function tryStep2PlutoFallback(bbl: string, appToken: string): Promise<Step2Result> {
  const steps: string[] = [];
  steps.push('Step 2: Attempting PLUTO fallback...');
  
  const candidates = [bbl, bbl.replace(/^0+/, '')];
  
  for (const candidateBbl of [...new Set(candidates)]) {
    const url = `${PLUTO_BASE_URL}?bbl=${candidateBbl}&$limit=1`;
    steps.push(`Trying PLUTO: bbl=${candidateBbl}`);
    
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (appToken) headers['X-App-Token'] = appToken;
    
    try {
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        steps.push(`PLUTO API error: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data) || data.length === 0) {
        steps.push('PLUTO returned no rows');
        continue;
      }
      
      const row = data[0] as Record<string, unknown>;
      steps.push(`PLUTO returned row with keys: ${Object.keys(row).slice(0, 10).join(', ')}...`);
      
      // Extract values
      const taxClassRaw = getFieldValue(row, PLUTO_FIELDS.taxClass);
      const taxClass = taxClassRaw ? String(taxClassRaw) : null;
      steps.push(`Tax Class: ${taxClass || 'not found'}`);
      
      const assessTotalRaw = getFieldValue(row, PLUTO_FIELDS.assessTotal);
      const assessedValue = parseNumericValue(assessTotalRaw);
      steps.push(`Assessed Total Value: ${assessedValue !== null ? `$${assessedValue.toLocaleString()}` : 'not found'}`);
      
      const exemptTotalRaw = getFieldValue(row, PLUTO_FIELDS.exemptTotal);
      const exemptValue = parseNumericValue(exemptTotalRaw) || 0;
      steps.push(`Exempt Total Value: $${exemptValue.toLocaleString()}`);
      
      // Calculate taxable value (PLUTO doesn't have billable AV, so this is an estimate)
      const taxableValue = assessedValue !== null ? Math.max(0, assessedValue - exemptValue) : null;
      steps.push(`Taxable AV (estimated): ${taxableValue !== null ? `$${taxableValue.toLocaleString()}` : 'cannot calculate'}`);
      
      // Get tax rate
      const { rate, rateDescription } = getTaxRate(taxClass);
      steps.push(`Tax Rate: ${rate !== null ? `${(rate * 100).toFixed(3)}%` : 'unknown'}`);
      
      // Calculate tax
      if (taxableValue !== null && rate !== null) {
        const annualTax = Math.round(taxableValue * rate * 100) / 100;
        const quarterlyBill = Math.round(annualTax / 4 * 100) / 100;
        steps.push(`Annual Tax (estimated): $${taxableValue.toLocaleString()} × ${(rate * 100).toFixed(3)}% = $${annualTax.toLocaleString()}`);
        steps.push(`Quarterly Bill (estimated): $${annualTax.toLocaleString()} ÷ 4 = $${quarterlyBill.toLocaleString()}`);
        
        const addressRaw = getFieldValue(row, PLUTO_FIELDS.address);
        const ownerRaw = getFieldValue(row, PLUTO_FIELDS.ownerName);
        const bldgClassRaw = getFieldValue(row, PLUTO_FIELDS.buildingClass);
        
        return {
          success: true,
          quarterlyBill,
          annualTax,
          taxClass,
          taxRate: rate,
          taxRateDescription: rateDescription,
          assessedValue,
          exemptValue,
          taxableValue,
          address: addressRaw ? String(addressRaw) : null,
          ownerName: ownerRaw ? String(ownerRaw) : null,
          buildingClass: bldgClassRaw ? String(bldgClassRaw) : null,
          url,
          error: null,
          row,
          steps,
        };
      }
      
      steps.push('PLUTO row found but cannot calculate tax (missing taxable value or rate)');
      
    } catch (error) {
      steps.push(`PLUTO fetch error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  steps.push('Step 2 failed: No usable PLUTO data found');
  
  return {
    success: false,
    quarterlyBill: null,
    annualTax: null,
    taxClass: null,
    taxRate: null,
    taxRateDescription: 'No data',
    assessedValue: null,
    exemptValue: null,
    taxableValue: null,
    address: null,
    ownerName: null,
    buildingClass: null,
    url: `${PLUTO_BASE_URL}?bbl=${bbl}`,
    error: 'No usable PLUTO data',
    row: null,
    steps,
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
    
    // Use view_bbl if provided, otherwise bbl
    const viewBbl = view_bbl || bbl;
    // For condo units, try building_bbl for assessment lookup
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
    const cacheKey = `v4:${normalizedBbl}`;
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
    
    // Get next due date
    const { dueDate, dueDateFormatted } = getNextQuarterDueDate();
    
    // ============ 3-STEP DATA STRATEGY ============
    
    let basis: TaxBasis = 'unavailable';
    let confidence: TaxConfidence = 'none';
    let basisExplanation = 'Assessment/tax data not available for this parcel from public datasets.';
    let quarterlyBill: number | null = null;
    let annualTax: number | null = null;
    let taxClass: string | null = null;
    let taxRate: number | null = null;
    let taxRateDescription = 'No data';
    let billableAV: number | null = null;
    let assessedValue: number | null = null;
    let exemptValue: number | null = null;
    let taxableValue: number | null = null;
    let address: string | null = null;
    let ownerName: string | null = null;
    let buildingClass: string | null = null;
    let dataSource = 'None';
    let noDataFound = true;
    
    const allSteps: string[] = [];
    let step1Result: Step1Result | null = null;
    let step2Result: Step2Result | null = null;
    
    // STEP 1: Try DOF Assessment Roll first
    step1Result = await tryStep1DofAssessment(normalizedBbl, appToken);
    allSteps.push(...step1Result.steps);
    
    if (step1Result.success) {
      // Use DOF data - highest confidence
      basis = 'dof_assessment';
      confidence = 'high';
      basisExplanation = 'Derived from NYC DOF Assessment Roll data.';
      quarterlyBill = step1Result.quarterlyBill;
      annualTax = step1Result.annualTax;
      taxClass = step1Result.taxClass;
      taxRate = step1Result.taxRate;
      taxRateDescription = step1Result.taxRateDescription;
      billableAV = step1Result.billableAV;
      assessedValue = step1Result.assessedValue;
      exemptValue = step1Result.exemptValue;
      taxableValue = billableAV; // DOF billable AV is the taxable value
      address = step1Result.address;
      ownerName = step1Result.ownerName;
      buildingClass = step1Result.buildingClass;
      dataSource = `NYC Open Data DOF Assessment (${DOF_ASSESSMENT_DATASET_ID})`;
      noDataFound = false;
      allSteps.push('✓ Step 1 SUCCESS: Using DOF Assessment data');
    } else {
      // STEP 2: Fall back to PLUTO
      allSteps.push('Step 1 failed, proceeding to Step 2...');
      step2Result = await tryStep2PlutoFallback(normalizedBbl, appToken);
      allSteps.push(...step2Result.steps);
      
      if (step2Result.success) {
        // Use PLUTO data - estimated confidence
        basis = 'pluto_estimate';
        confidence = 'estimated';
        basisExplanation = 'Estimate derived from PLUTO assessed value; may differ from official DOF bill.';
        quarterlyBill = step2Result.quarterlyBill;
        annualTax = step2Result.annualTax;
        taxClass = step2Result.taxClass;
        taxRate = step2Result.taxRate;
        taxRateDescription = step2Result.taxRateDescription;
        assessedValue = step2Result.assessedValue;
        exemptValue = step2Result.exemptValue;
        taxableValue = step2Result.taxableValue;
        address = step2Result.address;
        ownerName = step2Result.ownerName;
        buildingClass = step2Result.buildingClass;
        dataSource = `NYC Open Data PLUTO (${PLUTO_DATASET_ID})`;
        noDataFound = false;
        allSteps.push('✓ Step 2 SUCCESS: Using PLUTO estimate');
      } else {
        // STEP 3: Fail-safe - no data available
        allSteps.push('Step 2 failed, entering fail-safe mode (Step 3)');
        allSteps.push('✗ No assessment data available from any source');
      }
    }
    
    // Build result
    const result: TaxResult = {
      quarterly_bill: quarterlyBill,
      annual_tax: annualTax,
      billing_cycle: 'Quarterly',
      due_date: dueDate,
      due_date_formatted: dueDateFormatted,
      
      basis,
      confidence,
      basis_explanation: basisExplanation,
      
      tax_class: taxClass,
      tax_rate: taxRate,
      tax_rate_description: taxRateDescription,
      assessed_value: assessedValue,
      exempt_value: exemptValue,
      taxable_billable_av: taxableValue,
      
      // Arrears - always unavailable (we don't have reliable data)
      arrears: null,
      arrears_status: 'unavailable',
      arrears_note: 'Arrears data not available from public records.',
      
      bbl_used: normalizedBbl,
      address,
      owner_name: ownerName,
      building_class: buildingClass,
      data_source: dataSource,
      no_data_found: noDataFound,
      cache_status: 'MISS',
      cached_at: null,
    };
    
    if (includeDebug) {
      result.debug = {
        step1_attempted: true,
        step1_url: step1Result?.url || null,
        step1_success: step1Result?.success || false,
        step1_error: step1Result?.error || null,
        step2_attempted: step2Result !== null,
        step2_url: step2Result?.url || null,
        step2_success: step2Result?.success || false,
        step2_error: step2Result?.error || null,
        raw_dof_row: step1Result?.row || null,
        raw_pluto_row: step2Result?.row || null,
        dof_row_keys: step1Result?.row ? Object.keys(step1Result.row).sort() : [],
        pluto_row_keys: step2Result?.row ? Object.keys(step2Result.row).sort() : [],
        calculation_steps: allSteps,
      };
    }
    
    // Cache result
    const now = Date.now();
    cache.set(cacheKey, { data: result, timestamp: now });
    
    console.log(`[property-taxes] Result - basis: ${result.basis}, quarterly: $${result.quarterly_bill}, annual: $${result.annual_tax}, class: ${result.tax_class}`);
    
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
