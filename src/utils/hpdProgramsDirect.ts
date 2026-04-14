/**
 * Direct client-side queries to NYC Open Data for HPD program datasets.
 *
 * These supplement the HPDONLINE portal (https://hpdonline.nyc.gov/hpdonline/)
 * which requires auth we can't consume from a browser, so we fetch what's
 * publicly available via Socrata and deep-link out for the rest (I-Cards,
 * AEP history, Vacate Orders UI, CONH detail, etc.).
 *
 * Datasets used:
 *   - tesw-yqqr : HPD Registration (headcount / status per property)
 *   - feu5-w2e2 : HPD Registration Contacts (owner, head officer, site manager, agent)
 */
const SOCRATA_BASE = 'https://data.cityofnewyork.us/resource';

// --- BBL helpers -----------------------------------------------------------

interface BblParts {
  boro: string;   // "1".."5"
  block: string;  // 5-digit zero-padded
  lot: string;    // 5-digit zero-padded (HPD uses 5)
  lot4: string;   // 4-digit zero-padded fallback for datasets that use 4
}

function parseBbl(bbl: string): BblParts | null {
  if (!bbl || bbl.length !== 10) return null;
  return {
    boro: bbl.charAt(0),
    block: bbl.slice(1, 6),
    lot: bbl.slice(6, 10).padStart(5, '0'),
    lot4: bbl.slice(6, 10),
  };
}

// --- HPD Registration ------------------------------------------------------

export interface HpdRegistration {
  registrationId: string | null;
  buildingId: string | null;
  houseNumber: string | null;
  lowHouseNumber: string | null;
  highHouseNumber: string | null;
  streetName: string | null;
  boroId: string | null;
  zip: string | null;
  lastRegistrationDate: string | null;
  registrationEndDate: string | null;
  raw: Record<string, unknown>;
}

export async function fetchHpdRegistration(
  bbl: string,
  signal?: AbortSignal,
): Promise<HpdRegistration | null> {
  const parts = parseBbl(bbl);
  if (!parts) return null;

  const url = new URL(`${SOCRATA_BASE}/tesw-yqqr.json`);
  url.searchParams.set(
    '$where',
    `boroid='${parts.boro}' AND block='${parseInt(parts.block, 10)}' AND lot='${parseInt(parts.lot, 10)}'`,
  );
  url.searchParams.set('$limit', '5');
  url.searchParams.set('$order', 'lastregistrationdate DESC');

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Record<string, unknown>[];
    if (!rows.length) return null;
    const row = rows[0];
    return {
      registrationId: (row.registrationid as string) || null,
      buildingId: (row.buildingid as string) || null,
      houseNumber: (row.housenumber as string) || null,
      lowHouseNumber: (row.lowhousenumber as string) || null,
      highHouseNumber: (row.highhousenumber as string) || null,
      streetName: (row.streetname as string) || null,
      boroId: (row.boroid as string) || null,
      zip: (row.zip as string) || null,
      lastRegistrationDate: (row.lastregistrationdate as string) || null,
      registrationEndDate: (row.registrationenddate as string) || null,
      raw: row,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    console.warn('HPD registration fetch failed:', err);
    return null;
  }
}

// --- HPD Registration Contacts --------------------------------------------

export interface HpdContact {
  type: string | null;         // "HeadOfficer", "IndividualOwner", "CorporateOwner", "Agent", "SiteManager", etc.
  contactDescription: string | null;
  firstName: string | null;
  lastName: string | null;
  corporationName: string | null;
  businessHouseNumber: string | null;
  businessStreetName: string | null;
  businessCity: string | null;
  businessState: string | null;
  businessZip: string | null;
  raw: Record<string, unknown>;
}

export async function fetchHpdContacts(
  registrationId: string,
  signal?: AbortSignal,
): Promise<HpdContact[]> {
  if (!registrationId) return [];
  const url = new URL(`${SOCRATA_BASE}/feu5-w2e2.json`);
  url.searchParams.set('$where', `registrationid='${registrationId}'`);
  url.searchParams.set('$limit', '50');

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      type: (row.type as string) || null,
      contactDescription: (row.contactdescription as string) || null,
      firstName: (row.firstname as string) || null,
      lastName: (row.lastname as string) || null,
      corporationName: (row.corporationname as string) || null,
      businessHouseNumber: (row.businesshousenumber as string) || null,
      businessStreetName: (row.businessstreetname as string) || null,
      businessCity: (row.businesscity as string) || null,
      businessState: (row.businessstate as string) || null,
      businessZip: (row.businesszip as string) || null,
      raw: row,
    }));
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    console.warn('HPD contacts fetch failed:', err);
    return [];
  }
}

// --- AEP (Alternative Enforcement Program) --------------------------------
// Dataset: hcir-3275 — Buildings Selected for the AEP

export interface AepRecord {
  buildingId: string | null;
  aepStartDate: string | null;
  aepRound: string | null;
  currentStatus: string | null;   // "AEP Active", "Discharged", etc.
  violationsAtStart: number | null;
  totalUnits: number | null;
  raw: Record<string, unknown>;
}

export async function fetchAep(bbl: string, signal?: AbortSignal): Promise<AepRecord[]> {
  if (!bbl || bbl.length !== 10) return [];
  const url = new URL(`${SOCRATA_BASE}/hcir-3275.json`);
  url.searchParams.set('$where', `bbl='${bbl}'`);
  url.searchParams.set('$limit', '25');
  url.searchParams.set('$order', 'aep_start_date DESC');
  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return [];
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      buildingId: (row.building_id as string) || null,
      aepStartDate: (row.aep_start_date as string) || null,
      aepRound: (row.aep_round as string) || null,
      currentStatus: (row.current_status as string) || null,
      violationsAtStart: row.of_b_c_violations_at_start ? Number(row.of_b_c_violations_at_start) : null,
      totalUnits: row.total_units ? Number(row.total_units) : null,
      raw: row,
    }));
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    console.warn('AEP fetch failed:', err);
    return [];
  }
}

// --- Vacate Orders --------------------------------------------------------
// Dataset: tb8q-a3ar — Order to Repair/Vacate Orders

export interface VacateOrderRecord {
  orderNumber: string | null;
  primaryReason: string | null;
  vacateType: string | null;       // "Partial", "Full"
  effectiveDate: string | null;
  rescindDate: string | null;      // null = active
  numberOfVacatedUnits: number | null;
  isActive: boolean;
  raw: Record<string, unknown>;
}

export async function fetchVacateOrders(bbl: string, signal?: AbortSignal): Promise<VacateOrderRecord[]> {
  if (!bbl || bbl.length !== 10) return [];
  const url = new URL(`${SOCRATA_BASE}/tb8q-a3ar.json`);
  url.searchParams.set('$where', `bbl='${bbl}'`);
  url.searchParams.set('$limit', '50');
  url.searchParams.set('$order', 'vacate_effective_date DESC');
  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return [];
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows.map((row) => {
      const rescind = (row.actual_rescind_date as string) || null;
      return {
        orderNumber: (row.vacate_order_number as string) || null,
        primaryReason: (row.primary_vacate_reason as string) || null,
        vacateType: (row.vacate_type as string) || null,
        effectiveDate: (row.vacate_effective_date as string) || null,
        rescindDate: rescind,
        numberOfVacatedUnits: row.number_of_vacated_units ? Number(row.number_of_vacated_units) : null,
        isActive: !rescind,
        raw: row,
      };
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    console.warn('Vacate orders fetch failed:', err);
    return [];
  }
}

// --- Certificate of No Harassment (CONH) ----------------------------------
// Dataset: bzxi-2tsw — CONH Pilot Building List

export interface ConhRecord {
  dateAdded: string | null;
  aepOrder: boolean;
  hpdVacateOrder: boolean;
  dobVacateOrder: boolean;
  harassmentFinding: boolean;
  discharged7a: boolean;
  bqi: boolean;
  raw: Record<string, unknown>;
}

function yesToBool(v: unknown): boolean {
  return String(v || '').toLowerCase() === 'yes';
}

export async function fetchConh(bbl: string, signal?: AbortSignal): Promise<ConhRecord | null> {
  if (!bbl || bbl.length !== 10) return null;
  const url = new URL(`${SOCRATA_BASE}/bzxi-2tsw.json`);
  url.searchParams.set('$where', `bbl='${bbl}'`);
  url.searchParams.set('$limit', '5');
  url.searchParams.set('$order', 'date_added DESC');
  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return null;
    const rows = (await res.json()) as Record<string, unknown>[];
    if (!rows.length) return null;
    const row = rows[0];
    return {
      dateAdded: (row.date_added as string) || null,
      aepOrder: yesToBool(row.aep_order),
      hpdVacateOrder: yesToBool(row.hpd_vacate_order),
      dobVacateOrder: yesToBool(row.dob_vacate_order),
      harassmentFinding: yesToBool(row.harassment_finding),
      discharged7a: yesToBool(row.discharged_7a),
      bqi: yesToBool(row.bqi),
      raw: row,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    console.warn('CONH fetch failed:', err);
    return null;
  }
}

// --- Bed Bug Annual Reports -----------------------------------------------
// Dataset: wz6d-d3jb — Bedbug Reporting (Local Law 69)

export interface BedBugReport {
  filingDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalUnits: number | null;
  infestedUnits: number | null;
  eradicatedUnits: number | null;
  reInfestedUnits: number | null;
  raw: Record<string, unknown>;
}

export async function fetchBedBugReports(bbl: string, signal?: AbortSignal): Promise<BedBugReport[]> {
  if (!bbl || bbl.length !== 10) return [];
  const url = new URL(`${SOCRATA_BASE}/wz6d-d3jb.json`);
  url.searchParams.set('$where', `bbl='${bbl}'`);
  url.searchParams.set('$limit', '10');
  url.searchParams.set('$order', 'filing_date DESC');
  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return [];
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows.map((row) => ({
      filingDate: (row.filing_date as string) || null,
      periodStart: (row.filing_period_start_date as string) || null,
      periodEnd: (row.filling_period_end_date as string) || null,  // (sic — HPD typo in API)
      totalUnits: row.of_dwelling_units ? Number(row.of_dwelling_units) : null,
      infestedUnits: row.infested_dwelling_unit_count != null ? Number(row.infested_dwelling_unit_count) : null,
      eradicatedUnits: row.eradicated_unit_count != null ? Number(row.eradicated_unit_count) : null,
      reInfestedUnits: row.re_infested_dwelling_unit != null ? Number(row.re_infested_dwelling_unit) : null,
      raw: row,
    }));
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    console.warn('Bed bug reports fetch failed:', err);
    return [];
  }
}

// --- Housing Litigation ---------------------------------------------------
// Dataset: 59kj-x8nc — Housing Litigations

export interface LitigationRecord {
  litigationId: string | null;
  caseType: string | null;
  caseOpenDate: string | null;
  caseStatus: string | null;       // "OPEN", "CLOSED"
  caseJudgement: string | null;    // "YES", "NO"
  respondent: string | null;
  isOpen: boolean;
  raw: Record<string, unknown>;
}

export async function fetchLitigation(bbl: string, signal?: AbortSignal): Promise<LitigationRecord[]> {
  if (!bbl || bbl.length !== 10) return [];
  const url = new URL(`${SOCRATA_BASE}/59kj-x8nc.json`);
  url.searchParams.set('$where', `bbl='${bbl}'`);
  url.searchParams.set('$limit', '100');
  url.searchParams.set('$order', 'caseopendate DESC');
  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) return [];
    const rows = (await res.json()) as Record<string, unknown>[];
    return rows.map((row) => {
      const status = (row.casestatus as string) || null;
      return {
        litigationId: (row.litigationid as string) || null,
        caseType: (row.casetype as string) || null,
        caseOpenDate: (row.caseopendate as string) || null,
        caseStatus: status,
        caseJudgement: (row.casejudgement as string) || null,
        respondent: (row.respondent as string) || null,
        isOpen: (status || '').toUpperCase() === 'OPEN',
        raw: row,
      };
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    console.warn('Litigation fetch failed:', err);
    return [];
  }
}

// --- Deep-link builders for HPDONLINE -------------------------------------

const BOROUGH_NAME_TO_ID: Record<string, string> = {
  MANHATTAN: '1',
  BRONX: '2',
  BROOKLYN: '3',
  QUEENS: '4',
  'STATEN ISLAND': '5',
};

export function boroughToId(borough: string): string | null {
  const key = borough.toUpperCase().trim();
  return BOROUGH_NAME_TO_ID[key] || null;
}

/**
 * Parses "270 Dean Street" → { house: "270", street: "Dean Street" }.
 * Strips borough suffix if present (e.g. "270 Dean Street — Brooklyn").
 */
export function splitAddress(address: string): { house: string; street: string } | null {
  if (!address) return null;
  // Drop borough suffix
  const cleaned = address.split('—')[0].split('–')[0].split(',')[0].trim();
  const match = cleaned.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (!match) return null;
  return { house: match[1], street: match[2].trim() };
}

/**
 * Build the HPDONLINE building overview URL.
 * Falls back to the search page if we can't resolve components.
 */
export function buildHpdOnlineUrl(
  address: string,
  borough: string,
  buildingId?: string | null,
): string {
  // If we have the internal building ID, use direct route — most reliable
  if (buildingId) {
    return `https://hpdonline.nyc.gov/hpdonline/building/${buildingId}/overview`;
  }
  const parts = splitAddress(address);
  const boroId = boroughToId(borough);
  if (parts && boroId) {
    const qp = new URLSearchParams({
      houseNumber: parts.house,
      streetName: parts.street,
      boroughId: boroId,
    });
    return `https://hpdonline.nyc.gov/hpdonline/building/overview/overview?${qp.toString()}`;
  }
  return 'https://hpdonline.nyc.gov/hpdonline/';
}

/**
 * HPDONLINE only exposes one stable SPA route per building — the overview page.
 * Sub-sections (Archival Images, AEP, Vacate Orders, CONH) are all accessed as
 * buttons/modals on the overview page, not as their own routes. So every
 * deep-link lands on the overview and we tell the user which button to click.
 */
export function buildHpdOnlineImagesUrl(buildingId: string): string {
  return `https://hpdonline.nyc.gov/hpdonline/building/${buildingId}/overview`;
}

export function buildHpdOnlineAepUrl(buildingId: string): string {
  return `https://hpdonline.nyc.gov/hpdonline/building/${buildingId}/overview`;
}

export function buildHpdOnlineVacateUrl(buildingId: string): string {
  return `https://hpdonline.nyc.gov/hpdonline/building/${buildingId}/overview`;
}

export function buildHpdOnlineConhUrl(buildingId: string): string {
  return `https://hpdonline.nyc.gov/hpdonline/building/${buildingId}/overview`;
}
