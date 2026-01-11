import { Building2, MapPin, Hash } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { PropertyInfo } from '@/types/property';

interface PropertyHeaderProps {
  info: PropertyInfo;
}

export function PropertyHeader({ info }: PropertyHeaderProps) {
  return (
    <Card className="bg-card">
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg shrink-0">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                {info.address}
              </h1>
              <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span className="text-sm">{info.borough}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="font-mono">
              <Hash className="h-3 w-3 mr-1" />
              BBL: {info.bbl}
            </Badge>
            {info.bin && (
              <Badge variant="outline" className="font-mono">
                BIN: {info.bin}
              </Badge>
            )}
            <Badge variant="secondary" className="font-mono">
              Block: {info.block}
            </Badge>
            <Badge variant="secondary" className="font-mono">
              Lot: {info.lot}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
