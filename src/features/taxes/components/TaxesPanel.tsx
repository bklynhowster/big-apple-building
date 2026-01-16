/**
 * TaxesPanel - Single integration point for tax display
 * 
 * Decides what to render based on context:
 * - Unit page: TaxesCard with unit BBL
 * - Non-condo building: TaxesCard with building BBL
 * - Condo building: Returns null (taxes shown in UnitsTab)
 */

import { Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TaxesCard } from './TaxesCard';
import type { TaxesPanelProps } from '../types';

export function TaxesPanel({
  context,
  viewBbl,
  buildingBbl,
  address,
  isCondo = false,
}: TaxesPanelProps) {
  // Unit page: Show unit-level taxes
  if (context === 'unit') {
    return (
      <TaxesCard
        viewBbl={viewBbl}
        buildingBbl={undefined} // Never pass buildingBbl for unit pages
        address={address}
        isUnitPage={true}
      />
    );
  }

  // Condo building page: Suppress building-level taxes
  // UnitsTab handles unit-level taxes in its table
  if (isCondo) {
    // Return null - UnitsTab shows unit-level tax display
    return null;
  }

  // Non-condo building page: Show building-level taxes
  return (
    <TaxesCard
      viewBbl={viewBbl}
      buildingBbl={buildingBbl}
      address={address}
      isUnitPage={false}
    />
  );
}

/**
 * Standalone condo tax suppression notice
 * Use when you need to show the notice outside of UnitsTab
 */
export function CondoTaxSuppressionNotice() {
  return (
    <Alert className="py-2 border-primary/30 bg-primary/5">
      <Info className="h-4 w-4 text-primary" />
      <AlertDescription className="text-xs">
        <strong>Condominium buildings do not have building-level tax liability.</strong>{' '}
        All property taxes are assessed at the unit level.
      </AlertDescription>
    </Alert>
  );
}
