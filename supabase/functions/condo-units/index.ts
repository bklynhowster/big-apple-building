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

// Pass 2 fallback datasets (must have borough/block/lot + ideally bbl)
// Try these in order and pick the first whose schema supports the required filters.
const TAX_LOT_DATASET_CANDIDATES = [
  // Department of Finance Digital Tax Map (polygons; typically has bbl/block/lot)
  'smk3-tmxj',
  // NYC Zoning Tax Lot Database (contains bbl/block/lot)
  'fdkv-4t4z',
];

// -------- Caches --------

const schemaCache = new Map<string, { columns: Set<string>; timestamp: number }>();
const SCHEMA_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

const responseCache = new Map<string, { data: unknown; timestamp: number }>();
const RESPONSE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// -------- Types --------

export type InputRole = 'billing' | 'unit' | 'unknown';
export type StrategyUsed = 'condoDataset' | 'blockLotFallback';

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
  inputRole: InputRole;
  billingBbl: string | null;
  inputIsUnitLot: boolean;
  isCondo: boolean;
  strategyUsed: StrategyUsed;
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
  inputRole: InputRole;
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

function normalizeBblString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const raw = String(val).trim();
  if (!raw) return null;

  // Common case
  if (isValidBbl(raw)) return raw;

  // Socrata sometimes returns numeric-like strings (or floats rendered as strings)
  const n = Number(raw);
  if (Number.isFinite(n)) {
    const asInt = String(Math.trunc(n));
    if (isValidBbl(asInt)) return asInt;
  }

  // Last resort: strip non-digits
  const digits = raw.replace(/\D/g, '');
  if (isValidBbl(digits)) return digits;

  return null;
}

function getInputRoleFromLot(lot4: string): InputRole {
  if (looksLikeBillingLot(lot4)) return 'billing';
  if (looksLikeUnitLot(lot4)) return 'unit';
  return 'unknown';
}

function getUnitBblColumn(unitsCols: Set<string>): string | null {
  return firstCol(unitsCols, ['unit_bbl', 'bbl']);
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

function pickBestCondoKeyFromUnitsRow(columns: Set<string>, row: Record<string, unknown>): CondoKeyKind | null {
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

function baseBblFromUnitsRow(columns: Set<string>, row: Record<string, unknown>): string | null {
  // Note: condo_base_bbl is the base tax lot (not necessarily the billing lot).
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

async function lookupBillingBblFromComplex(
  complexCols: Set<string>,
  condoKey: CondoKeyKind | null,
  appToken: string,
  requestId: string
): Promise<string | null> {
  if (!condoKey) return null;

  const billingCol = firstCol(complexCols, ['condo_billing_bbl']);
  if (!billingCol) return null;

  // Only query if the complex dataset has the corresponding key column.
  if (!hasCol(complexCols, condoKey.column)) return null;

  const q = new URLSearchParams();
  q.set('$select', `${billingCol}`);
  q.set('$where', `${condoKey.column}='${escapeSoqlLiteral(condoKey.value)}'`);
  q.set('$limit', '1');

  const { resp, url } = await soqlFetch(CONDO_COMPLEX_DATASET_ID, q, appToken);
  console.log(
    `[${requestId}] condo-context lookupBillingBblFromComplex dataset=${CONDO_COMPLEX_DATASET_ID} where=${condoKey.column}='${condoKey.value}' url=${url}`
  );

  if (!resp.ok) return null;
  const rows = await resp.json();
  const row = Array.isArray(rows) && rows[0] ? (rows[0] as Record<string, unknown>) : null;
  if (!row) return null;

  const billing = String(row[billingCol] || '').trim();
  return isValidBbl(billing) ? billing : null;
}

async function resolveCondoContext(inputBbl: string, appToken: string, requestId: string): Promise<CondoContext> {
  const parsed = parseBbl(inputBbl);
  if (!parsed) {
    return { isCondo: false, condoKey: null, billingBbl: null, inputIsUnitLot: false, inputRole: 'unknown' };
  }

  const heuristics = {
    lotLooksLikeUnit: looksLikeUnitLot(parsed.lot),
    lotLooksLikeBilling: looksLikeBillingLot(parsed.lot),
  };

  console.log(
    `[${requestId}] condo-units datasets complex=${CONDO_COMPLEX_DATASET_ID} units=${CONDO_UNITS_DATASET_ID}`
  );

  const unitsCols = await discoverSchema(CONDO_UNITS_DATASET_ID, appToken);
  const complexCols = await discoverSchema(CONDO_COMPLEX_DATASET_ID, appToken);

  // 1) If possible, treat as unit lookup first (strongest way to resolve condo key)
  const unitBblCol = hasCol(unitsCols, 'unit_bbl') ? 'unit_bbl' : null;
  if (unitBblCol) {
    const selectCols = [
      unitBblCol,
      ...[
        'condo_key',
        'condo_base_bbl_key',
        'condo_number',
        'condo_base_bbl',
        'condo_base_boro',
        'condo_base_block',
        'condo_base_lot',
      ].filter((c) => hasCol(unitsCols, c)),
    ];

    const where = `${unitBblCol}='${escapeSoqlLiteral(inputBbl)}'`;
    const q = new URLSearchParams();
    q.set('$select', selectCols.join(','));
    q.set('$where', where);
    q.set('$limit', '1');

    const { resp, url } = await soqlFetch(CONDO_UNITS_DATASET_ID, q, appToken);
    console.log(`[${requestId}] condo-context dataset=${CONDO_UNITS_DATASET_ID} where=${where} url=${url}`);

    if (resp.ok) {
      const rows = await resp.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as Record<string, unknown>;
        const condoKey = pickBestCondoKeyFromUnitsRow(unitsCols, row);

        // Prefer billing BBL from condo complex dataset if available.
        const billingBbl =
          (await lookupBillingBblFromComplex(complexCols, condoKey, appToken, requestId)) || null;

        return {
          isCondo: true,
          condoKey,
          billingBbl,
          inputIsUnitLot: true,
          inputRole: 'unit',
        };
      }
    }
  }

  // 2) Treat as billing/complex record: query condo complex dataset first.
  const whereCandidates: { where: string; role: InputRole }[] = [];

  if (hasCol(complexCols, 'condo_billing_bbl')) {
    whereCandidates.push({
      where: `condo_billing_bbl='${escapeSoqlLiteral(inputBbl)}'`,
      role: 'billing',
    });
  }

  if (hasCol(complexCols, 'condo_base_bbl')) {
    // Some condo complexes may be keyed by base BBL.
    whereCandidates.push({
      where: `condo_base_bbl='${escapeSoqlLiteral(inputBbl)}'`,
      role: heuristics.lotLooksLikeBilling ? 'billing' : 'unknown',
    });
  }

  if (
    hasCol(complexCols, 'condo_base_boro') &&
    hasCol(complexCols, 'condo_base_block') &&
    hasCol(complexCols, 'condo_base_lot')
  ) {
    // Socrata often stores numeric columns without leading zeros.
    const boro = normalizeIntString(parsed.borough);
    const block = String(parseInt(parsed.block, 10));
    const lot = String(parseInt(parsed.lot, 10));

    whereCandidates.push({
      where: `condo_base_boro='${escapeSoqlLiteral(boro)}' AND condo_base_block='${escapeSoqlLiteral(block)}' AND condo_base_lot='${escapeSoqlLiteral(lot)}'`,
      role: heuristics.lotLooksLikeBilling ? 'billing' : 'unknown',
    });
  }

  for (const candidate of whereCandidates) {
    const selectCols = [
      ...[
        'condo_billing_bbl',
        'condo_key',
        'condo_base_bbl_key',
        'condo_number',
        'condo_base_bbl',
      ].filter((c) => hasCol(complexCols, c)),
    ];

    const q = new URLSearchParams();
    q.set('$select', selectCols.join(',') || 'condo_billing_bbl');
    q.set('$where', candidate.where);
    q.set('$limit', '1');

    const { resp, url } = await soqlFetch(CONDO_COMPLEX_DATASET_ID, q, appToken);
    console.log(
      `[${requestId}] condo-context dataset=${CONDO_COMPLEX_DATASET_ID} where=${candidate.where} url=${url}`
    );

    if (!resp.ok) continue;

    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const row = rows[0] as Record<string, unknown>;

    const billingRaw = hasCol(complexCols, 'condo_billing_bbl') ? String(row['condo_billing_bbl'] || '').trim() : '';
    const billingBbl = isValidBbl(billingRaw)
      ? billingRaw
      : (heuristics.lotLooksLikeBilling ? inputBbl : null);

    let condoKey: CondoKeyKind | null = null;
    if (hasCol(complexCols, 'condo_key') && row['condo_key']) {
      condoKey = { kind: 'condo_key', column: 'condo_key', value: String(row['condo_key']) };
    } else if (hasCol(complexCols, 'condo_base_bbl_key') && row['condo_base_bbl_key']) {
      condoKey = {
        kind: 'condo_base_bbl_key',
        column: 'condo_base_bbl_key',
        value: String(row['condo_base_bbl_key']),
      };
    } else if (hasCol(complexCols, 'condo_number') && row['condo_number']) {
      condoKey = { kind: 'condo_number', column: 'condo_number', value: String(row['condo_number']) };
    } else if (hasCol(complexCols, 'condo_base_bbl') && row['condo_base_bbl']) {
      condoKey = { kind: 'condo_base_bbl', column: 'condo_base_bbl', value: String(row['condo_base_bbl']) };
    }

    return {
      isCondo: true,
      condoKey,
      billingBbl,
      inputIsUnitLot: false,
      inputRole: candidate.role,
    };
  }

  // 3) Treat as base record by searching for units pointing at this base (supports non-75xx base BBL inputs).
  const baseWhereCandidates: string[] = [];

  if (hasCol(unitsCols, 'condo_base_bbl')) {
    baseWhereCandidates.push(`condo_base_bbl='${escapeSoqlLiteral(inputBbl)}'`);
  }

  if (
    hasCol(unitsCols, 'condo_base_boro') &&
    hasCol(unitsCols, 'condo_base_block') &&
    hasCol(unitsCols, 'condo_base_lot')
  ) {
    const boro = normalizeIntString(parsed.borough);
    const block = String(parseInt(parsed.block, 10));
    const lot = String(parseInt(parsed.lot, 10));
    baseWhereCandidates.push(
      `condo_base_boro='${escapeSoqlLiteral(boro)}' AND condo_base_block='${escapeSoqlLiteral(block)}' AND condo_base_lot='${escapeSoqlLiteral(lot)}'`
    );
  }

  for (const where of baseWhereCandidates) {
    const count = await soqlCount(CONDO_UNITS_DATASET_ID, where, appToken);
    if (count <= 0) continue;

    const q = new URLSearchParams();
    q.set(
      '$select',
      [
        ...[
          'condo_key',
          'condo_base_bbl_key',
          'condo_number',
          'condo_base_bbl',
          'condo_base_boro',
          'condo_base_block',
          'condo_base_lot',
        ].filter((c) => hasCol(unitsCols, c)),
      ].join(',')
    );
    q.set('$where', where);
    q.set('$limit', '1');

    const { resp, url } = await soqlFetch(CONDO_UNITS_DATASET_ID, q, appToken);
    console.log(`[${requestId}] condo-context dataset=${CONDO_UNITS_DATASET_ID} where=${where} url=${url}`);

    const rows = resp.ok ? await resp.json() : [];
    const row = Array.isArray(rows) && rows[0] ? (rows[0] as Record<string, unknown>) : {};

    const condoKey = pickBestCondoKeyFromUnitsRow(unitsCols, row);
    const billingBbl =
      (await lookupBillingBblFromComplex(complexCols, condoKey, appToken, requestId)) ||
      (heuristics.lotLooksLikeBilling ? inputBbl : null);

    return {
      isCondo: true,
      condoKey,
      billingBbl,
      inputIsUnitLot: false,
      inputRole: 'billing',
    };
  }

  // No evidence this is a condo in DTM datasets.
  console.log(`[${requestId}] resolveCondoContext: no DTM matches; heuristics=${JSON.stringify(heuristics)}`);
  return {
    isCondo: false,
    condoKey: null,
    billingBbl: null,
    inputIsUnitLot: false,
    inputRole: 'unknown',
  };
}

// -------- Unit enumeration (paginated) --------

function buildUnitsWhereClause(
  unitsCols: Set<string>,
  ctx: CondoContext
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

  // Fallback: condo_base_bbl is the most direct linkage in the unit dataset.
  if (ctx.billingBbl && hasCol(unitsCols, 'condo_base_bbl')) {
    return { where: `condo_base_bbl='${escapeSoqlLiteral(ctx.billingBbl)}'`, reason: 'condo_base_bbl' };
  }

  return { where: null, reason: 'missing_columns' };
}

function normalizeUnitFromRow(unitsCols: Set<string>, row: Record<string, unknown>): CondoUnit | null {
  const unitBblCol = getUnitBblColumn(unitsCols);
  if (!unitBblCol) return null;

  const unitBbl = normalizeBblString(row[unitBblCol]);
  if (!unitBbl) return null;

  const parsed = parseBbl(unitBbl);
  if (!parsed) return null;

  const unitLabelCol = firstCol(unitsCols, ['unit_designation', 'unit_desig', 'unit', 'apt', 'apartment']);

  const labelRaw = unitLabelCol ? row[unitLabelCol] : null;
  const unitLabel =
    labelRaw !== null && labelRaw !== undefined && String(labelRaw).trim() !== ''
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

function pickTaxLotDataset(
  appToken: string,
  requestId: string
): Promise<{ datasetId: string; cols: Set<string> } | null> {
  return (async () => {
    for (const datasetId of TAX_LOT_DATASET_CANDIDATES) {
      const cols = await discoverSchema(datasetId, appToken);
      const boroCol = firstCol(cols, ['borocode', 'boro', 'borough', 'boro_code']);
      const blockCol = firstCol(cols, ['block', 'tax_block']);
      const lotCol = firstCol(cols, ['lot', 'tax_lot']);
      const bblCol = firstCol(cols, ['bbl']);

      const ok = Boolean(boroCol && blockCol && lotCol && (bblCol || (boroCol && blockCol && lotCol)));
      console.log(
        `[${requestId}] pass2 candidate dataset=${datasetId} ok=${ok} colsNeeded={boro:${boroCol},block:${blockCol},lot:${lotCol},bbl:${bblCol}}`
      );
      if (ok) return { datasetId, cols };
    }
    return null;
  })();
}

async function enumerateUnitsByBlockLotFallback(args: {
  inputBbl: string;
  limit: number;
  offset: number;
  appToken: string;
  requestId: string;
}): Promise<{ units: CondoUnit[]; totalApprox: number; datasetId: string | null; where: string | null }> {
  const parsed = parseBbl(args.inputBbl);
  if (!parsed) return { units: [], totalApprox: 0, datasetId: null, where: null };

  const chosen = await pickTaxLotDataset(args.appToken, args.requestId);
  if (!chosen) {
    console.log(`[${args.requestId}] pass2 no suitable tax lot dataset found from candidates=${TAX_LOT_DATASET_CANDIDATES.join(',')}`);
    return { units: [], totalApprox: 0, datasetId: null, where: null };
  }

  const { datasetId, cols } = chosen;
  const boroCol = firstCol(cols, ['borocode', 'boro', 'borough', 'boro_code']);
  const blockCol = firstCol(cols, ['block', 'tax_block']);
  const lotCol = firstCol(cols, ['lot', 'tax_lot']);
  const bblCol = firstCol(cols, ['bbl']);

  if (!boroCol || !blockCol || !lotCol) {
    return { units: [], totalApprox: 0, datasetId, where: null };
  }

  // Socrata often stores numeric columns without leading zeros.
  const boro = normalizeIntString(parsed.borough);
  const block = String(parseInt(parsed.block, 10));

  const where = `${boroCol}='${escapeSoqlLiteral(boro)}' AND ${blockCol}='${escapeSoqlLiteral(block)}' AND ${lotCol} BETWEEN 1001 AND 6999`;

  console.log(`[${args.requestId}] pass2 enumerate dataset=${datasetId} where=${where}`);

  const totalApprox = await soqlCount(datasetId, where, args.appToken);

  const labelCol = firstCol(cols, ['unit', 'apt', 'apartment', 'unit_designation', 'unit_desig']);

  const selectCols = [
    ...(bblCol ? [bblCol] : []),
    ...(boroCol ? [boroCol] : []),
    ...(blockCol ? [blockCol] : []),
    ...(lotCol ? [lotCol] : []),
    ...(labelCol ? [labelCol] : []),
  ].filter(Boolean);

  const q = new URLSearchParams();
  q.set('$select', Array.from(new Set(selectCols)).join(','));
  q.set('$where', where);
  q.set('$order', `${lotCol}`);
  q.set('$limit', String(args.limit));
  q.set('$offset', String(args.offset));

  const { resp, url } = await soqlFetch(datasetId, q, args.appToken);
  if (!resp.ok) {
    console.log(`[${args.requestId}] pass2 query failed dataset=${datasetId} status=${resp.status} url=${url}`);
    return { units: [], totalApprox, datasetId, where };
  }

  const rows = await resp.json();
  const units: CondoUnit[] = [];

  if (Array.isArray(rows)) {
    for (const r of rows) {
      const row = r as Record<string, unknown>;

      const lot = normalizeIntString(row[lotCol]);
      if (!lot) continue;

      const unitBbl =
        (bblCol ? normalizeBblString(row[bblCol]) : null) ||
        composeBbl(boro, block, lot);

      if (!isValidBbl(unitBbl)) continue;

      const unitLabelRaw = labelCol ? row[labelCol] : null;
      const unitLabel =
        unitLabelRaw !== null && unitLabelRaw !== undefined && String(unitLabelRaw).trim() !== ''
          ? String(unitLabelRaw).trim()
          : `Lot ${String(parseInt(lot, 10))}`;

      units.push({
        unitBbl,
        borough: boro,
        block,
        lot: String(parseInt(lot, 10)),
        unitLabel,
        raw: row,
      });
    }
  }

  console.log(
    `[${args.requestId}] pass2 result dataset=${datasetId} where=${where} totalApprox=${totalApprox} returned=${units.length}`
  );

  return { units, totalApprox, datasetId, where };
}

Deno.serve(async (req) => {
  const requestId = generateRequestId();

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    const bbl = (url.searchParams.get('bbl') || '').trim();
    const limitRaw = url.searchParams.get('limit');
    const offsetRaw = url.searchParams.get('offset');

    if (!isValidBbl(bbl)) {
      return new Response(
        JSON.stringify({ error: 'Invalid BBL', userMessage: 'BBL must be exactly 10 digits.', requestId }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Allow large condo enumerations (requested: limit=2000). Socrata can handle it, but keep a safety cap.
    const limit = Math.min(Math.max(parseInt(limitRaw || '2000', 10) || 2000, 1), 5000);
    const offset = Math.max(parseInt(offsetRaw || '0', 10) || 0, 0);

    const cacheKey = `condo-units:v4:${bbl}:${limit}:${offset}`;
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < RESPONSE_CACHE_TTL) {
      return new Response(JSON.stringify(cached.data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appToken = Deno.env.get('NYC_OPEN_DATA_APP_TOKEN') || '';
    const parsed = parseBbl(bbl);
    const inputRole: InputRole = parsed ? getInputRoleFromLot(parsed.lot) : 'unknown';
    const inputIsUnitLot = inputRole === 'unit';

    // Pass 1: attempt to resolve condo context using condo datasets (DTM).
    const ctx = await resolveCondoContext(bbl, appToken, requestId);
    const unitsCols = await discoverSchema(CONDO_UNITS_DATASET_ID, appToken);

    let pass1Units: CondoUnit[] = [];
    let pass1TotalApprox = 0;
    let pass1Where: string | null = null;

    if (ctx.isCondo) {
      const { where, reason } = buildUnitsWhereClause(unitsCols, ctx);
      pass1Where = where;

      console.log(
        `[${requestId}] pass1 dataset=${CONDO_UNITS_DATASET_ID} where=${where ?? 'null'} reason=${reason}`
      );

      if (where) {
        pass1TotalApprox = await soqlCount(CONDO_UNITS_DATASET_ID, where, appToken);

        const unitBblCol = getUnitBblColumn(unitsCols);
        const selectCols = [
          ...(unitBblCol ? [unitBblCol] : []),
          ...['unit_boro', 'unit_block', 'unit_lot', 'unit_designation'].filter((c) => hasCol(unitsCols, c)),
        ];

        const q = new URLSearchParams();
        q.set('$select', Array.from(new Set(selectCols)).join(',') || (unitBblCol ?? 'bbl'));
        q.set('$where', where);
        if (unitBblCol) q.set('$order', unitBblCol);
        q.set('$limit', String(limit));
        q.set('$offset', String(offset));

        const { resp: unitsResp, url: unitsUrl } = await soqlFetch(CONDO_UNITS_DATASET_ID, q, appToken);

        if (!unitsResp.ok) {
          console.log(`[${requestId}] pass1 query failed dataset=${CONDO_UNITS_DATASET_ID} status=${unitsResp.status} url=${unitsUrl}`);
          pass1Units = [];
          pass1TotalApprox = 0;
        } else {
          const rows = await unitsResp.json();
          if (Array.isArray(rows)) {
            for (const r of rows) {
              const unit = normalizeUnitFromRow(unitsCols, r as Record<string, unknown>);
              if (unit) pass1Units.push(unit);
            }
          }
          console.log(
            `[${requestId}] pass1 result dataset=${CONDO_UNITS_DATASET_ID} where=${where} totalApprox=${pass1TotalApprox} returned=${pass1Units.length}`
          );
        }
      } else {
        console.log(
          `[${requestId}] pass1 Condo confirmed but cannot build unit WHERE. unitsCols=${Array.from(unitsCols).join(',')}`
        );
      }
    } else {
      console.log(`[${requestId}] pass1 resolveCondoContext isCondo=false (will consider pass2 fallback)`);
    }

    // Pass 2: block/lot-range fallback.
    const lotLooksBilling = parsed ? looksLikeBillingLot(parsed.lot) : false;
    const lotLooksUnit = parsed ? looksLikeUnitLot(parsed.lot) : false;
    const shouldRunPass2 = pass1Units.length === 0 && (lotLooksBilling || lotLooksUnit || ctx.isCondo);

    let strategyUsed: StrategyUsed = 'condoDataset';
    let finalUnits = pass1Units;
    let totalApprox = pass1TotalApprox;

    if (shouldRunPass2) {
      const pass2 = await enumerateUnitsByBlockLotFallback({
        inputBbl: bbl,
        limit,
        offset,
        appToken,
        requestId,
      });

      strategyUsed = 'blockLotFallback';
      finalUnits = pass2.units;
      totalApprox = pass2.totalApprox;

      console.log(
        `[${requestId}] strategyUsed=${strategyUsed} pass1={dataset:${CONDO_UNITS_DATASET_ID},where:${pass1Where ?? 'null'},count:${pass1Units.length}} pass2={dataset:${pass2.datasetId ?? 'null'},where:${pass2.where ?? 'null'},count:${pass2.units.length}}`
      );

      if (ctx.isCondo && pass2.units.length === 0) {
        console.log(
          `[${requestId}] Condo detected but 0 unit lots returned from pass2 tax lot dataset. pass2dataset=${pass2.datasetId ?? 'null'} where=${pass2.where ?? 'null'}`
        );
      }
    } else {
      console.log(
        `[${requestId}] strategyUsed=${strategyUsed} pass1={dataset:${CONDO_UNITS_DATASET_ID},where:${pass1Where ?? 'null'},count:${pass1Units.length}}`
      );
    }

    const inferredIsCondo = ctx.isCondo || lotLooksBilling || lotLooksUnit;
    const billingBbl = ctx.billingBbl || (inputRole === 'billing' ? bbl : null);

    const respBody: CondoUnitsListResponse = {
      inputBbl: bbl,
      inputRole,
      billingBbl,
      inputIsUnitLot,
      isCondo: inferredIsCondo,
      strategyUsed,
      units: finalUnits,
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


