import "https://deno.land/x/xhr@0.3.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// DOF Digital Tax Map datasets (NYC Open Data)
// - Condo complex context
const CONDO_COMPLEX_DATASET_ID = 'p8u6-a6it';
// - Unit-level lots
const CONDO_UNITS_DATASET_ID = 'eguu-7ie3';

// -------- Caches --------

const schemaCache = new Map<string, { columns: Set<string>; timestamp: number }>();
const SCHEMA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const responseCache = new Map<string, { data: unknown; timestamp: number }>();
const RESPONSE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// -------- Types --------

export interface CondoUnit {
  unitBbl: string;
  borough: string;
  block: string;
  lot: string;
  unitLabel: string | null;
  raw: Record<string, unknown>;
}

export interface CondoUnitsListResponse {
  inputBbl: string;
  billingBbl: string | null;
  inputIsUnitLot: boolean;
  isCondo: boolean;
  units: CondoUnit[];
  totalApprox: number;
  requestId: string;
}

type CondoKeyKind =
  | { kind: 'condo_key'; column: string; value: string }
  | { kind: 'condo_base_bbl_key'; column: string; value: string }
  | { kind: 'condo_number'; column: string; value: string; baseBoro?: string; baseBlock?: string }
  | { kind: 'condo_base_bbl'; column: string; value: string };

interface CondoContext {
  isCondo: boolean;
  condoKey: CondoKeyKind | null;
  billingBbl: string | null;
  inputIsUnitLot: boolean;
}

// -------- Utilities --------

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function isValidBbl(bbl: string): boolean {
  return /^\d{10}$/.test(bbl);
}

function parseBbl(bbl: string): { borough: string; block: string; lot: string } | null {
  if (!isValidBbl(bbl)) return null;
  return {
    borough: bbl.slice(0, 1),
    block: bbl.slice(1, 6),
    lot: bbl.slice(6, 10),
  };
}

function composeBbl(boro: string, block: string, lot: string): string {
  return `${boro}${String(block).padStart(5, '0')}${String(lot).padStart(4, '0')}`;
}

function normalizeIntString(val: unknown): string {
  if (val === null || val === undefined) return '';
  const n = Number(String(val).trim());
  if (Number.isFinite(n)) return String(Math.trunc(n));
  return String(val).trim();
}

function discoverColumnSetFromRow(row: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(row).map((k) => k.toLowerCase()));
}

async function discoverSchema(datasetId: string, appToken: string): Promise<Set<string>> {
  const cacheKey = `schema:${datasetId}`;
  const cached = schemaCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SCHEMA_CACHE_TTL) return cached.columns;

  const url = `https://data.cityofnewyork.us/resource/${datasetId}.json?$limit=1`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;

  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      console.error(`[discoverSchema] ${datasetId} failed: ${resp.status}`);
      return new Set();
    }
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) return new Set();

    const columns = discoverColumnSetFromRow(rows[0]);
    schemaCache.set(cacheKey, { columns, timestamp: Date.now() });
    console.log(`[discoverSchema] ${datasetId}: ${Array.from(columns).join(', ')}`);
    return columns;
  } catch (e) {
    console.error(`[discoverSchema] ${datasetId} error:`, e);
    return new Set();
  }
}

function hasCol(columns: Set<string>, col: string): boolean {
  return columns.has(col.toLowerCase());
}

function firstCol(columns: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (hasCol(columns, c)) return c;
  }
  return null;
}

function escapeSoqlLiteral(value: string): string {
  // Minimal escaping for Socrata SOQL string literals.
  return value.replace(/'/g, "''");
}

async function soqlFetch(datasetId: string, query: URLSearchParams, appToken: string) {
  const url = `https://data.cityofnewyork.us/resource/${datasetId}.json?${query.toString()}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (appToken) headers['X-App-Token'] = appToken;
  const resp = await fetch(url, { headers });
  return { resp, url };
}

async function soqlCount(datasetId: string, where: string, appToken: string): Promise<number> {
  const q = new URLSearchParams();
  q.set('$select', 'count(*) as __count');
  q.set('$where', where);
  const { resp } = await soqlFetch(datasetId, q, appToken);
  if (!resp.ok) return 0;
  const rows = await resp.json();
  const raw = Array.isArray(rows) && rows[0] ? rows[0].__count ?? rows[0].count : '0';
  const n = parseInt(String(raw || '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

// -------- Condo context resolution (DTM first, schema-safe) --------

function looksLikeUnitLot(lot4: string): boolean {
  const lotNum = parseInt(lot4, 10);
  return Number.isFinite(lotNum) && lotNum >= 1001 && lotNum <= 6999;
}

function looksLikeBillingLot(lot4: string): boolean {
  const lotNum = parseInt(lot4, 10);
  return Number.isFinite(lotNum) && lotNum >= 7501 && lotNum <= 7599;
}

function pickBestCondoKeyFromUnitsRow(
  columns: Set<string>,
  row: Record<string, unknown>
): CondoKeyKind | null {
  // Prefer strongest keys present in the unit dataset itself.
  if (hasCol(columns, 'condo_key') && row['condo_key']) {
    return { kind: 'condo_key', column: 'condo_key', value: String(row['condo_key']) };
  }
  if (hasCol(columns, 'condo_base_bbl_key') && row['condo_base_bbl_key']) {
    return {
      kind: 'condo_base_bbl_key',
      column: 'condo_base_bbl_key',
      value: String(row['condo_base_bbl_key']),
    };
  }
  if (hasCol(columns, 'condo_number') && row['condo_number']) {
    const baseBoro = hasCol(columns, 'condo_base_boro') ? normalizeIntString(row['condo_base_boro']) : undefined;
    const baseBlock = hasCol(columns, 'condo_base_block') ? normalizeIntString(row['condo_base_block']) : undefined;
    return {
      kind: 'condo_number',
      column: 'condo_number',
      value: String(row['condo_number']),
      baseBoro: baseBoro || undefined,
      baseBlock: baseBlock || undefined,
    };
  }
  if (hasCol(columns, 'condo_base_bbl') && row['condo_base_bbl']) {
    return {
      kind: 'condo_base_bbl',
      column: 'condo_base_bbl',
      value: String(row['condo_base_bbl']),
    };
  }
  return null;
}

function billingBblFromUnitsRow(columns: Set<string>, row: Record<string, unknown>): string | null {
  if (hasCol(columns, 'condo_base_bbl') && row['condo_base_bbl']) {
    const v = String(row['condo_base_bbl']).trim();
    return isValidBbl(v) ? v : null;
  }

  const boroCol = hasCol(columns, 'condo_base_boro') ? 'condo_base_boro' : null;
  const blockCol = hasCol(columns, 'condo_base_block') ? 'condo_base_block' : null;
  const lotCol = hasCol(columns, 'condo_base_lot') ? 'condo_base_lot' : null;

  if (boroCol && blockCol && lotCol) {
    const boro = normalizeIntString(row[boroCol]);
    const block = normalizeIntString(row[blockCol]);
    const lot = normalizeIntString(row[lotCol]);
    if (boro && block && lot) {
      const bbl = composeBbl(boro, block, lot);
      return isValidBbl(bbl) ? bbl : null;
    }
  }

  return null;
}

async function resolveCondoContext(inputBbl: string, appToken: string, requestId: string): Promise<CondoContext> {
  const parsed = parseBbl(inputBbl);
  if (!parsed) return { isCondo: false, condoKey: null, billingBbl: null, inputIsUnitLot: false };

  const unitsCols = await discoverSchema(CONDO_UNITS_DATASET_ID, appToken);
  const unitBblCol = hasCol(unitsCols, 'unit_bbl') ? 'unit_bbl' : null;

  const heuristics = {
    lotLooksLikeUnit: looksLikeUnitLot(parsed.lot),
    lotLooksLikeBilling: looksLikeBillingLot(parsed.lot),
  };

  // 1) If possible, treat as unit lookup first (strongest way to resolve condo key)
  if (unitBblCol) {
    const selectCols = [
      ...(['condo_key', 'condo_base_bbl_key', 'condo_number', 'condo_base_bbl', 'condo_base_boro', 'condo_base_block', 'condo_base_lot']
        .filter((c) => hasCol(unitsCols, c))),
    ];

    const q = new URLSearchParams();
    q.set('$select', selectCols.join(',') || unitBblCol);
    q.set('$where', `${unitBblCol}='${escapeSoqlLiteral(inputBbl)}'`);
    q.set('$limit', '1');

    const { resp, url } = await soqlFetch(CONDO_UNITS_DATASET_ID, q, appToken);
    if (resp.ok) {
      const rows = await resp.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as Record<string, unknown>;
        const billingBbl = billingBblFromUnitsRow(unitsCols, row);
        const condoKey = pickBestCondoKeyFromUnitsRow(unitsCols, row);

        console.log(`[${requestId}] resolveCondoContext: matched as unit lot via ${unitBblCol}; url=${url}`);
        return {
          isCondo: true,
          condoKey,
          billingBbl,
          inputIsUnitLot: true,
        };
      }
    }
  }

  // 2) Treat as condo base / billing record (find any units pointing at this base)
  const baseWhereCandidates: string[] = [];

  if (hasCol(unitsCols, 'condo_base_bbl')) {
    baseWhereCandidates.push(`condo_base_bbl='${escapeSoqlLiteral(inputBbl)}'`);
  }

  if (hasCol(unitsCols, 'condo_base_boro') && hasCol(unitsCols, 'condo_base_block') && hasCol(unitsCols, 'condo_base_lot')) {
    const boro = normalizeIntString(parsed.borough);
    const block = normalizeIntString(parsed.block);
    const lot = normalizeIntString(parsed.lot);
    // Socrata often stores numeric columns without leading zeros.
    baseWhereCandidates.push(
      `condo_base_boro='${escapeSoqlLiteral(boro)}' AND condo_base_block='${escapeSoqlLiteral(String(parseInt(block, 10)))}' AND condo_base_lot='${escapeSoqlLiteral(String(parseInt(lot, 10)))}'`
    );
  }

  for (const where of baseWhereCandidates) {
    const count = await soqlCount(CONDO_UNITS_DATASET_ID, where, appToken);
    if (count > 0) {
      // Fetch a row to extract best key / billingBbl
      const selectCols = [
        ...(['condo_key', 'condo_base_bbl_key', 'condo_number', 'condo_base_bbl', 'condo_base_boro', 'condo_base_block', 'condo_base_lot']
          .filter((c) => hasCol(unitsCols, c))),
      ];
      const q = new URLSearchParams();
      q.set('$select', selectCols.join(','));
      q.set('$where', where);
      q.set('$limit', '1');

      const { resp, url } = await soqlFetch(CONDO_UNITS_DATASET_ID, q, appToken);
      const rows = resp.ok ? await resp.json() : [];
      const row = Array.isArray(rows) && rows[0] ? (rows[0] as Record<string, unknown>) : {};

      const condoKey = pickBestCondoKeyFromUnitsRow(unitsCols, row);
      const billingBbl = billingBblFromUnitsRow(unitsCols, row) || inputBbl;

      console.log(`[${requestId}] resolveCondoContext: matched as base/billing via units dataset; where=${where}; url=${url}`);
      return {
        isCondo: true,
        condoKey,
        billingBbl,
        inputIsUnitLot: false,
      };
    }
  }

  // 3) As a last resort, consult condo complex dataset (p8u6-a6it) to confirm condo/billing context.
  // This keeps us aligned with the requested DOF datasets even when the unit dataset doesn't match.
  const complexCols = await discoverSchema(CONDO_COMPLEX_DATASET_ID, appToken);
  if (complexCols.size > 0) {
    // Find likely "billing bbl" / "bbl" column without guessing: discover then pick.
    const billingBblCol = firstCol(complexCols, ['billing_bbl', 'billingbbl', 'condo_base_bbl', 'condo_bbl', 'bbl']);
    const condoKeyCol = firstCol(complexCols, ['condo_key', 'condo_base_bbl_key', 'condo_number', 'condonumber', 'condo_no', 'condono']);

    if (billingBblCol) {
      const q = new URLSearchParams();
      const selectCols = [billingBblCol, condoKeyCol].filter(Boolean) as string[];
      q.set('$select', selectCols.join(',') || billingBblCol);
      q.set('$where', `${billingBblCol}='${escapeSoqlLiteral(inputBbl)}'`);
      q.set('$limit', '1');

      const { resp, url } = await soqlFetch(CONDO_COMPLEX_DATASET_ID, q, appToken);
      if (resp.ok) {
        const rows = await resp.json();
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0] as Record<string, unknown>;
          const billing = String(row[billingBblCol] || '').trim();
          const billingBbl = isValidBbl(billing) ? billing : null;

          let condoKey: CondoKeyKind | null = null;
          if (condoKeyCol && row[condoKeyCol]) {
            if (condoKeyCol === 'condo_key') condoKey = { kind: 'condo_key', column: condoKeyCol, value: String(row[condoKeyCol]) };
            else if (condoKeyCol === 'condo_base_bbl_key') condoKey = { kind: 'condo_base_bbl_key', column: condoKeyCol, value: String(row[condoKeyCol]) };
            else condoKey = { kind: 'condo_number', column: condoKeyCol, value: String(row[condoKeyCol]) };
          }

          console.log(`[${requestId}] resolveCondoContext: matched in condo complex dataset; url=${url}`);

          // inputIsUnitLot best-effort from heuristic
          return {
            isCondo: true,
            condoKey,
            billingBbl: billingBbl || inputBbl,
            inputIsUnitLot: heuristics.lotLooksLikeUnit && !heuristics.lotLooksLikeBilling,
          };
        }
      }
    }
  }

  // No evidence this is a condo in DTM datasets.
  console.log(`[${requestId}] resolveCondoContext: no DTM matches; heuristics=${JSON.stringify(heuristics)}`);
  return {
    isCondo: false,
    condoKey: null,
    billingBbl: null,
    inputIsUnitLot: false,
  };
}

// -------- Unit enumeration (paginated) --------

function buildUnitsWhereClause(
  unitsCols: Set<string>,
  ctx: CondoContext,
  requestId: string
): { where: string | null; reason: string } {
  // Prefer strongest key if it can be applied to the units dataset.
  if (ctx.condoKey && hasCol(unitsCols, ctx.condoKey.column)) {
    if (ctx.condoKey.kind === 'condo_number') {
      // If we have base boro/block in the units dataset, include them to reduce collisions.
      const clauses: string[] = [`${ctx.condoKey.column}='${escapeSoqlLiteral(ctx.condoKey.value)}'`];
      if (ctx.condoKey.baseBoro && hasCol(unitsCols, 'condo_base_boro')) {
        clauses.push(`condo_base_boro='${escapeSoqlLiteral(ctx.condoKey.baseBoro)}'`);
      }
      if (ctx.condoKey.baseBlock && hasCol(unitsCols, 'condo_base_block')) {
        clauses.push(`condo_base_block='${escapeSoqlLiteral(String(parseInt(ctx.condoKey.baseBlock, 10)))}'`);
      }
      return { where: clauses.join(' AND '), reason: 'condo_number(+base)' };
    }

    return {
      where: `${ctx.condoKey.column}='${escapeSoqlLiteral(ctx.condoKey.value)}'`,
      reason: ctx.condoKey.kind,
    };
  }

  // Fallback: condo_base_bbl is the most direct "billing bbl" linkage in the unit dataset.
  if (ctx.billingBbl && hasCol(unitsCols, 'condo_base_bbl')) {
    return { where: `condo_base_bbl='${escapeSoqlLiteral(ctx.billingBbl)}'`, reason: 'condo_base_bbl' };
  }

  console.log(`[${requestId}] buildUnitsWhereClause: unable to build where (missing columns)`);
  return { where: null, reason: 'missing_columns' };
}

function normalizeUnitFromRow(unitsCols: Set<string>, row: Record<string, unknown>): CondoUnit | null {
  const unitBblCol = hasCol(unitsCols, 'unit_bbl') ? 'unit_bbl' : null;
  if (!unitBblCol) return null;

  const unitBbl = String(row[unitBblCol] || '').trim();
  if (!isValidBbl(unitBbl)) return null;

  const parsed = parseBbl(unitBbl);
  if (!parsed) return null;

  const unitLabelCol = firstCol(unitsCols, ['unit_designation', 'unit_desig', 'unit', 'apt', 'apartment']);

  const labelRaw = unitLabelCol ? row[unitLabelCol] : null;
  const unitLabel = labelRaw !== null && labelRaw !== undefined && String(labelRaw).trim() !== ''
    ? String(labelRaw).trim()
    : null;

  return {
    unitBbl,
    borough: parsed.borough,
    block: String(parseInt(parsed.block, 10)),
    lot: String(parseInt(parsed.lot, 10)),
    unitLabel,
    raw: row,
  };
}

Deno.serve(async (req) => {
  const requestId = generateRequestId();

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // Required by spec
    const bbl = (url.searchParams.get('bbl') || '').trim();
    const limitRaw = url.searchParams.get('limit');
    const offsetRaw = url.searchParams.get('offset');

    if (!isValidBbl(bbl)) {
      return new Response(
        JSON.stringify({ error: 'Invalid BBL', userMessage: 'BBL must be exactly 10 digits.', requestId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const limit = Math.min(Math.max(parseInt(limitRaw || '200', 10) || 200, 1), 1000);
    const offset = Math.max(parseInt(offsetRaw || '0', 10) || 0, 0);

    const cacheKey = `condo-units:v2:${bbl}:${limit}:${offset}`;
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < RESPONSE_CACHE_TTL) {
      return new Response(JSON.stringify(cached.data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    const ctx = await resolveCondoContext(bbl, appToken, requestId);

    const unitsCols = await discoverSchema(CONDO_UNITS_DATASET_ID, appToken);

    if (!ctx.isCondo) {
      const resp: CondoUnitsListResponse = {
        inputBbl: bbl,
        billingBbl: null,
        inputIsUnitLot: false,
        isCondo: false,
        units: [],
        totalApprox: 0,
        requestId,
      };
      responseCache.set(cacheKey, { data: resp, timestamp: Date.now() });
      return new Response(JSON.stringify(resp), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { where, reason } = buildUnitsWhereClause(unitsCols, ctx, requestId);
    if (!where) {
      // Condo confirmed but can't query units due to schema mismatch.
      console.log(`[${requestId}] Condo confirmed but cannot build unit WHERE. unitsCols=${Array.from(unitsCols).join(',')}`);
      const resp: CondoUnitsListResponse = {
        inputBbl: bbl,
        billingBbl: ctx.billingBbl,
        inputIsUnitLot: ctx.inputIsUnitLot,
        isCondo: true,
        units: [],
        totalApprox: 0,
        requestId,
      };
      responseCache.set(cacheKey, { data: resp, timestamp: Date.now() });
      return new Response(JSON.stringify(resp), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const totalApprox = await soqlCount(CONDO_UNITS_DATASET_ID, where, appToken);

    const selectCols = [
      ...(['unit_bbl', 'unit_boro', 'unit_block', 'unit_lot', 'unit_designation'].filter((c) => hasCol(unitsCols, c))),
    ];

    // Keep raw minimally large, but still provide a meaningful raw record.
    // We include the full row from Socrata response (within the selected cols); this satisfies `raw`.
    const q = new URLSearchParams();
    q.set('$select', selectCols.join(',') || 'unit_bbl');
    q.set('$where', where);
    if (hasCol(unitsCols, 'unit_bbl')) q.set('$order', 'unit_bbl');
    q.set('$limit', String(limit));
    q.set('$offset', String(offset));

    const { resp: unitsResp, url: unitsUrl } = await soqlFetch(CONDO_UNITS_DATASET_ID, q, appToken);
    if (!unitsResp.ok) {
      console.log(`[${requestId}] Units query failed: status=${unitsResp.status}; url=${unitsUrl}`);
      return new Response(
        JSON.stringify({ error: 'Upstream error', userMessage: 'Unable to load condo units right now.', requestId }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rows = await unitsResp.json();
    const units: CondoUnit[] = [];
    if (Array.isArray(rows)) {
      for (const r of rows) {
        const unit = normalizeUnitFromRow(unitsCols, r as Record<string, unknown>);
        if (unit) units.push(unit);
      }
    }

    if (ctx.isCondo && totalApprox > 0 && units.length === 0) {
      console.log(
        `[${requestId}] DTM returned zero rows for condo though count>0. where=${where}; reason=${reason}; unitsUrl=${unitsUrl}`
      );
    }

    const respBody: CondoUnitsListResponse = {
      inputBbl: bbl,
      billingBbl: ctx.billingBbl,
      inputIsUnitLot: ctx.inputIsUnitLot,
      isCondo: true,
      units,
      totalApprox,
      requestId,
    };

    responseCache.set(cacheKey, { data: respBody, timestamp: Date.now() });

    return new Response(JSON.stringify(respBody), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[${requestId}] Error in condo-units:`, err);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        userMessage: 'An unexpected error occurred while processing your request.',
        requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
