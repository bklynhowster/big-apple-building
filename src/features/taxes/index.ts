/**
 * NYC DOF Property Taxes Feature Module
 * 
 * This module contains all tax-related UI, hooks, and utilities.
 * 
 * Usage:
 * ```tsx
 * import { TaxesPanel } from '@/features/taxes';
 * 
 * <TaxesPanel
 *   context="building"
 *   viewBbl={bbl}
 *   isCondo={isCondo}
 * />
 * ```
 */

// Components
export { TaxesCard, TaxesPanel, CondoTaxSuppressionNotice } from './components';

// Hooks
export { usePropertyTaxes, useCondoUnitTaxes, INITIAL_TAX_BATCH_SIZE } from './hooks';

// Types
export type {
  PropertyTaxResult,
  DebugInfo,
  BillingCycle,
  PaymentStatus,
  TaxContext,
  CondoUnitTaxSummary,
  TaxesPanelProps,
  TaxesCardProps,
} from './types';

// Utils
export {
  formatUSD,
  formatUSDForTable,
  formatDate,
  formatBblForDisplay,
  formatLot,
  parseBBL,
  getDOFCityPayUrl,
  getDOFBillsUrl,
  getTaxContextLabel,
  getPaymentStatusInfo,
  getPaymentStatusBadgeInfo,
} from './utils';

// Constants
export {
  INITIAL_TAX_BATCH_SIZE as TAX_BATCH_SIZE,
  MAX_CONCURRENT_TAX_REQUESTS,
  YIELD_INTERVAL_MS,
  TAX_CACHE_TTL_MS,
} from './types';
