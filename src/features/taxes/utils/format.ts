/**
 * Formatting utilities for tax display
 */

/**
 * Safely format a number as USD currency
 * Returns 'Unavailable' for null/undefined/NaN values
 */
export function formatUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'Unavailable';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Format USD for table cells (returns em-dash for null)
 */
export function formatUSDForTable(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Format a date string for display
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * Parse a BBL string into its components
 */
export function parseBBL(bbl: string): { borough: string; block: string; lot: string } | null {
  if (!bbl || bbl.length !== 10) return null;
  return {
    borough: bbl.charAt(0),
    block: bbl.slice(1, 6),
    lot: bbl.slice(6, 10),
  };
}

/**
 * Format a BBL for display (e.g., "1-00123-0001")
 */
export function formatBblForDisplay(bbl: string): string {
  const parsed = parseBBL(bbl);
  if (!parsed) return bbl;
  return `${parsed.borough}-${parsed.block}-${parsed.lot}`;
}

/**
 * Get the NYC DOF CityPay URL for property tax payments
 */
export function getDOFCityPayUrl(): string {
  return 'https://a836-citypay.nyc.gov/citypay/PropertyTax';
}

/**
 * Get the NYC DOF property tax bills page URL
 */
export function getDOFBillsUrl(): string {
  return 'https://www.nyc.gov/site/finance/property/property-tax-bills-and-payments.page';
}

/**
 * Get context label for tax display
 */
export function getTaxContextLabel(context: 'building' | 'unit'): string {
  return context === 'unit' ? 'Unit BBL taxes' : 'Billing BBL taxes';
}

/**
 * Format lot number for display (strips leading zeros)
 */
export function formatLot(lot: string): string {
  const n = Number(lot);
  if (Number.isFinite(n)) return String(Math.trunc(n));
  return lot;
}
