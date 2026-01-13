import { MapPin } from 'lucide-react';
import type { PropertyInfo } from '@/types/property';

interface PropertyHeaderProps {
  info: PropertyInfo;
}

export function PropertyHeader({ info }: PropertyHeaderProps) {
  return (
    <div className="border-b border-border pb-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        {/* Address with vertical accent rule - document heading style */}
        <div className="flex items-start gap-4">
          <div className="w-0.5 h-full min-h-[56px] bg-primary flex-shrink-0" />
          <div>
            <p className="elk-case-header mb-2">Property Record</p>
            <h1 className="elk-property-address">
              {info.address}
            </h1>
            <div className="flex items-center gap-2 mt-2 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span className="text-sm">{info.borough}</span>
            </div>
          </div>
        </div>
        
        {/* Structured metadata pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="elk-metadata-pill">
            <span className="text-muted-foreground mr-1.5">BBL</span>
            {info.bbl}
          </span>
          {info.bin && (
            <span className="elk-metadata-pill">
              <span className="text-muted-foreground mr-1.5">BIN</span>
              {info.bin}
            </span>
          )}
          <span className="elk-metadata-pill">
            <span className="text-muted-foreground mr-1.5">Block</span>
            {info.block}
          </span>
          <span className="elk-metadata-pill">
            <span className="text-muted-foreground mr-1.5">Lot</span>
            {info.lot}
          </span>
        </div>
      </div>
    </div>
  );
}
