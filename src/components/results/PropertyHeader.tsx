import { MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { PropertyInfo } from '@/types/property';

interface PropertyHeaderProps {
  info: PropertyInfo;
}

export function PropertyHeader({ info }: PropertyHeaderProps) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          {/* Address with vertical accent rule */}
          <div className="flex items-start gap-4">
            <div className="w-0.5 h-full min-h-[48px] bg-primary rounded-full flex-shrink-0" />
            <div>
              <p className="elk-case-header mb-1">Property Record</p>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                {info.address}
              </h1>
              <div className="flex items-center gap-2 mt-1.5 text-muted-foreground">
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
      </CardContent>
    </Card>
  );
}
