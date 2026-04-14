/**
 * ACRIS-powered co-op unit roster.
 *
 * Fetches unit-level data from three NYC Open Data / ACRIS datasets:
 *   1. Real Property Legals  (8h5j-fqxa) — unit numbers per document
 *   2. Real Property Master   (bnx9-e6tj) — doc type, amount, date
 *   3. Real Property Parties  (636b-3b5g) — buyer/seller names
 *
 * For co-ops, ACRIS records share transfers (RPTT filings, assignments, etc.)
 * that reference individual apartment numbers. By aggregating all documents
 * for a BBL we can reconstruct a near-complete unit roster with transaction
 * history — something no single NYC dataset exposes for co-ops.
 */

// ─── Dataset IDs ───

const ACRIS_LEGALS_ID = '8h5j-fqxa';
const ACRIS_MASTER_ID = 'bnx9-e6tj';
const ACRIS_PARTIES_ID = '636b-3b5g';

const BASE = 'https://data.cityofnewyork.us/resource';

// ─── Types ───

export interface AcrisTransaction {
  documentId: string;
  docType: string;
  documentDate: string | null;
  recordedDate: string | null;
  amount: number | null;
  parties: AcrisParty[];
}

export interface AcrisParty {
  name: string;
  role: 'seller' | 'buyer' | 'other';
  address: string | null;
}

export interface AcrisUnit {
  unit: string;
  transactions: AcrisTransaction[];
  lastTransactionDate: string | null;
  lastSaleAmount: number | null;
  lastBuyer: string | null;
  lastSeller: string | null;
  transactionCount: number;
}

export interface AcrisUnitRosterResult {
  units: AcrisUnit[];
  totalDocuments: number;
  error: string | null;
  bbl: string;
}

// ─── Helpers ───

function parseBbl(bbl: string): { borough: string; block: string; lot: string } | null {
  const clean = String(bbl).trim().padStart(10, '0');
  if (clean.length !== 10) return null;
  return {
    borough: clean.substring(0, 1),
    block: clean.substring(1, 6),
    lot: clean.substring(6, 10).replace(/^0+/, '').padStart(2, '0'),
  };
}

// Friendly doc type labels
const DOC_TYPE_LABELS: Record<string, string> = {
  'RPTT&RET': 'Transfer Tax',
  'DEED': 'Deed',
  'DEEDO': 'Deed',
  'MTGE': 'Mortgage',
  'AGMT': 'Agreement',
  'ASST': 'Assignment',
  'SAT': 'Satisfaction',
  'AALR': 'Assignment of Leases & Rents',
  'AL&R': 'Assignment of Leases & Rents',
  'SPRD': 'Spread Agreement',
  'CORRM': 'Corrected Mortgage',
  'M&CON': 'Mortgage & Consolidation',
  'CNSL': 'Consolidation',
  'UCC1': 'UCC Filing',
  'UCC3': 'UCC Amendment',
  'PTED': 'Partial Termination',
};

function friendlyDocType(raw: string): string {
  return DOC_TYPE_LABELS[raw] || raw;
}

function naturalUnitSort(a: string, b: string): number {
  // Numeric-aware sort: 1A < 2 < 2B < 10 < PH
  const re = /(\d+)|(\D+)/g;
  const aParts = a.match(re) || [];
  const bParts = b.match(re) || [];

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || '';
    const bPart = bParts[i] || '';
    const aNum = parseInt(aPart, 10);
    const bNum = parseInt(bPart, 10);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      const cmp = aPart.localeCompare(bPart);
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

// ─── Fetchers ───

async function fetchLegals(
  borough: string,
  block: string,
  lot: string,
  signal?: AbortSignal,
  addressHint?: { streetNumber: string; streetName: string } | null
): Promise<{ documentId: string; unit: string }[]> {
  const where = `borough='${borough}' AND block='${block.replace(/^0+/, '')}' AND lot='${lot.replace(/^0+/, '')}'`;
  const url = `${BASE}/${ACRIS_LEGALS_ID}.json?$where=${encodeURIComponent(where)}&$select=document_id,unit&$limit=5000`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`ACRIS Legals: HTTP ${res.status}`);
  const data: any[] = await res.json();

  let filtered = data.filter((r) => r.unit && r.unit.trim());

  // Condo fallback: if lot-based query returned no unit records, try address-based query.
  // ACRIS often uses original subdivision lots for condos, not the PLUTO 75xx condo lots.
  if (filtered.length === 0 && addressHint?.streetNumber && addressHint?.streetName) {
    // Extract just the core street name for LIKE matching (e.g., "12 STREET" or "12TH STREET")
    const cleanStreet = addressHint.streetName.toUpperCase().replace(/\s*(STREET|ST|AVENUE|AVE|PLACE|PL|BOULEVARD|BLVD|DRIVE|DR|ROAD|RD|LANE|LN|COURT|CT)\s*$/i, '').trim();
    const addrWhere = `borough='${borough}' AND block='${block.replace(/^0+/, '')}' AND street_number='${addressHint.streetNumber}' AND street_name like '%${cleanStreet}%'`;
    const addrUrl = `${BASE}/${ACRIS_LEGALS_ID}.json?$where=${encodeURIComponent(addrWhere)}&$select=document_id,unit,lot&$limit=5000`;

    const addrRes = await fetch(addrUrl, { signal });
    if (addrRes.ok) {
      const addrData: any[] = await addrRes.json();
      filtered = addrData.filter((r) => r.unit && r.unit.trim());
    }
  }

  // If we found unit-tagged records, return them grouped by unit
  if (filtered.length > 0) {
    return filtered.map((r) => ({
      documentId: r.document_id,
      unit: r.unit.trim().toUpperCase().replace(/^APT\s*/i, '').replace(/^#/, ''),
    }));
  }

  // Fallback: no unit-tagged records — return ALL legals as building-level transactions.
  // This covers multifamily homes and properties where ACRIS records don't reference
  // individual units. Label them as "Building" so they still appear in Sales/ACRIS.
  if (data.length > 0) {
    return data.map((r: any) => ({
      documentId: r.document_id,
      unit: 'BLDG',
    }));
  }

  return [];
}

async function fetchMasterDocs(
  documentIds: string[],
  signal?: AbortSignal
): Promise<Map<string, { docType: string; documentDate: string | null; recordedDate: string | null; amount: number | null }>> {
  if (documentIds.length === 0) return new Map();

  const results = new Map<string, { docType: string; documentDate: string | null; recordedDate: string | null; amount: number | null }>();

  // Batch in groups of 50 to avoid URL length limits
  const batchSize = 50;
  for (let i = 0; i < documentIds.length; i += batchSize) {
    const batch = documentIds.slice(i, i + batchSize);
    const inClause = batch.map((id) => `'${id}'`).join(',');
    const url = `${BASE}/${ACRIS_MASTER_ID}.json?$where=${encodeURIComponent(`document_id in(${inClause})`)}&$limit=5000`;

    const res = await fetch(url, { signal });
    if (!res.ok) continue;
    const data: any[] = await res.json();

    for (const r of data) {
      if (!results.has(r.document_id)) {
        results.set(r.document_id, {
          docType: r.doc_type || 'UNKNOWN',
          documentDate: r.document_date || null,
          recordedDate: r.recorded_datetime || null,
          amount: r.document_amt ? parseFloat(r.document_amt) : null,
        });
      }
    }
  }

  return results;
}

async function fetchParties(
  documentIds: string[],
  signal?: AbortSignal
): Promise<Map<string, AcrisParty[]>> {
  if (documentIds.length === 0) return new Map();

  const results = new Map<string, AcrisParty[]>();

  const batchSize = 50;
  for (let i = 0; i < documentIds.length; i += batchSize) {
    const batch = documentIds.slice(i, i + batchSize);
    const inClause = batch.map((id) => `'${id}'`).join(',');
    const url = `${BASE}/${ACRIS_PARTIES_ID}.json?$where=${encodeURIComponent(`document_id in(${inClause})`)}&$select=document_id,party_type,name,address_1&$limit=5000`;

    const res = await fetch(url, { signal });
    if (!res.ok) continue;
    const data: any[] = await res.json();

    for (const r of data) {
      const party: AcrisParty = {
        name: (r.name || '').trim(),
        role: r.party_type === '1' ? 'seller' : r.party_type === '2' ? 'buyer' : 'other',
        address: r.address_1 || null,
      };

      if (!results.has(r.document_id)) {
        results.set(r.document_id, []);
      }
      results.get(r.document_id)!.push(party);
    }
  }

  return results;
}

// ─── Main export ───

export async function fetchAcrisUnitRoster(
  bbl: string,
  signal?: AbortSignal,
  addressHint?: { streetNumber: string; streetName: string } | null
): Promise<AcrisUnitRosterResult> {
  const parsed = parseBbl(bbl);
  if (!parsed) {
    return { units: [], totalDocuments: 0, error: 'Invalid BBL', bbl };
  }

  try {
    // Step 1: Get all legals (unit → document mappings)
    // For condos, falls back to address-based search if lot-based returns nothing
    const legals = await fetchLegals(parsed.borough, parsed.block, parsed.lot, signal, addressHint);

    if (legals.length === 0) {
      return { units: [], totalDocuments: 0, error: null, bbl };
    }

    // Step 2: Get unique document IDs
    const allDocIds = [...new Set(legals.map((l) => l.documentId))];

    // Step 3: Fetch master docs and parties in parallel
    const [masterMap, partiesMap] = await Promise.all([
      fetchMasterDocs(allDocIds, signal),
      fetchParties(allDocIds, signal),
    ]);

    // Step 4: Group by unit
    const unitMap = new Map<string, { docIds: Set<string> }>();
    for (const legal of legals) {
      if (!unitMap.has(legal.unit)) {
        unitMap.set(legal.unit, { docIds: new Set() });
      }
      unitMap.get(legal.unit)!.docIds.add(legal.documentId);
    }

    // Step 5: Build unit roster
    const units: AcrisUnit[] = [];

    for (const [unitLabel, { docIds }] of unitMap) {
      const transactions: AcrisTransaction[] = [];

      for (const docId of docIds) {
        const master = masterMap.get(docId);
        const parties = partiesMap.get(docId) || [];

        transactions.push({
          documentId: docId,
          docType: master ? friendlyDocType(master.docType) : 'Unknown',
          documentDate: master?.documentDate || null,
          recordedDate: master?.recordedDate || null,
          amount: master?.amount || null,
          parties,
        });
      }

      // Sort transactions by date, newest first
      transactions.sort((a, b) => {
        const dateA = a.recordedDate || a.documentDate || '';
        const dateB = b.recordedDate || b.documentDate || '';
        return dateB.localeCompare(dateA);
      });

      // Find the most recent transaction with a meaningful amount (sale/transfer, not $0 mortgage satisfactions)
      const lastSale = transactions.find((t) => t.amount && t.amount > 0);
      const lastTx = transactions[0];

      const buyers = lastSale?.parties.filter((p) => p.role === 'buyer') || [];
      const sellers = lastSale?.parties.filter((p) => p.role === 'seller') || [];

      units.push({
        unit: unitLabel,
        transactions,
        lastTransactionDate: lastTx?.recordedDate || lastTx?.documentDate || null,
        lastSaleAmount: lastSale?.amount || null,
        lastBuyer: buyers.length > 0 ? buyers.map((p) => p.name).join(', ') : null,
        lastSeller: sellers.length > 0 ? sellers.map((p) => p.name).join(', ') : null,
        transactionCount: transactions.length,
      });
    }

    // Sort units naturally
    units.sort((a, b) => naturalUnitSort(a.unit, b.unit));

    return {
      units,
      totalDocuments: allDocIds.length,
      error: null,
      bbl,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { units: [], totalDocuments: 0, error: null, bbl };
    }
    return {
      units: [],
      totalDocuments: 0,
      error: e instanceof Error ? e.message : 'Failed to fetch ACRIS data',
      bbl,
    };
  }
}
