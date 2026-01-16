/**
 * Types for the NYC DOF Property Taxes feature module
 * 
 * Edge function request/response shapes and frontend types
 */

// ============================================================================
// Edge Function Types (property-taxes)
// ============================================================================

export type BillingCycle = 'Quarterly' | 'Semiannual' | 'Unknown';
export type PaymentStatus = 'paid' | 'unpaid' | 'unknown';

/**
 * Debug info returned when debug=true is passed to property-taxes edge function
 */
export interface DebugInfo {
  request_url: string;
  fields_used: {
    due_date: string[];
    liability: string[];
    balance: string[];
    code: string[];
    tax_year: string[];
    period: string[];
  };
  first_row_keys: string[];
  running_balance_detected: boolean;
  latest_period_key: string | null;
  latest_due_date_raw: string | null;
  periods: Array<{
    due_date: string | null;
    max_liab: number;
    max_bal: number;
    row_count: number;
    codes: string[];
  }>;
  computation_log: string[];
  arrears_debug: {
    today: string;
    latest_due_date: string | null;
    latest_period_balance: number | null;
    periods_considered: number;
    periods_included_in_arrears: string[];
    max_prior_balance: number | null;
    exclusion_reason?: string;
    running_balance_detected?: boolean;
  };
}

/**
 * Result from the property-taxes edge function
 */
export interface PropertyTaxResult {
  // Primary outputs
  latest_bill_amount: number | null;
  latest_due_date: string | null;
  billing_cycle: BillingCycle;
  billing_cycle_evidence: string;
  
  // Payment status
  payment_status: PaymentStatus;
  latest_period_balance: number | null;
  
  // Arrears
  arrears: number | null;
  arrears_available: boolean;
  arrears_note: string;
  
  // Metadata
  bbl_used: string;
  matched_field: string | null;
  matched_key: string | null;
  total_rows_fetched: number;
  period_count: number;
  rows_in_latest_period: number;
  data_source: string;
  no_data_found: boolean;
  cache_status: 'HIT' | 'MISS';
  cached_at: string | null;
  
  // Debug (only when debug=true)
  debug?: DebugInfo;
}

// ============================================================================
// Frontend Types
// ============================================================================

/**
 * Tax context for UI rendering decisions
 */
export type TaxContext = 'building' | 'unit';

/**
 * Summary of a single condo unit's tax data (for lazy loading)
 */
export interface CondoUnitTaxSummary {
  unitBbl: string;
  unitLabel: string | null;
  loading: boolean;
  error: string | null;
  data: PropertyTaxResult | null;
}

/**
 * Props for the TaxesPanel wrapper component
 */
export interface TaxesPanelProps {
  /** Context: 'building' for building-level view, 'unit' for unit-level view */
  context: TaxContext;
  /** The primary BBL being viewed */
  viewBbl: string;
  /** Building BBL (for condo units navigating back) */
  buildingBbl?: string;
  /** Address for display */
  address?: string;
  /** Array of condo units (only for condo buildings) */
  condoUnits?: Array<{ unitBbl: string; unitLabel: string | null; lot: string }>;
  /** Whether this is a condominium building */
  isCondo?: boolean;
  /** Total number of condo units (may differ from condoUnits.length if paginated) */
  totalCondoUnits?: number;
  /** Number of visible/loaded units (for lazy loading coordination) */
  visibleUnitCount?: number;
  /** Callback when more taxes should be loaded */
  onLoadMoreTaxes?: () => void;
  /** Callback when all taxes should be loaded */
  onLoadAllTaxes?: () => void;
}

/**
 * Props for the single-BBL TaxesCard component
 */
export interface TaxesCardProps {
  viewBbl: string;
  buildingBbl?: string;
  address?: string;
  isUnitPage?: boolean;
}

/**
 * Props for condo unit tax preview component
 */
export interface CondoUnitTaxPreviewProps {
  /** Array of condo units to display */
  units: Array<{ unitBbl: string; unitLabel: string | null; lot: string }>;
  /** Map of unit BBL -> tax summary */
  unitTaxes: Map<string, CondoUnitTaxSummary>;
  /** Number of units to fetch taxes for */
  taxVisibleCount: number;
  /** Whether batch loading is in progress */
  batchLoading: boolean;
  /** Count of units with tax data loaded */
  loadedCount: number;
  /** Count of units with arrears */
  arrearsCount: number;
  /** Count of units with unpaid status */
  unpaidCount: number;
  /** Callback to load more taxes */
  onLoadMoreTaxes: () => void;
  /** Callback to load all taxes */
  onLoadAllTaxes: () => void;
  /** Callback to retry a single unit's tax fetch */
  onRetryTax: (unitBbl: string, unitLabel: string | null) => void;
  /** Whether there are more taxes to load */
  hasMoreTaxes: boolean;
}

// ============================================================================
// Configuration Constants
// ============================================================================

/** Initial number of units to fetch taxes for */
export const INITIAL_TAX_BATCH_SIZE = 10;

/** Maximum concurrent tax fetch requests */
export const MAX_CONCURRENT_TAX_REQUESTS = 3;

/** Yield interval between batches (ms) to prevent UI freeze */
export const YIELD_INTERVAL_MS = 50;

/** Frontend cache TTL for tax data (ms) */
export const TAX_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
