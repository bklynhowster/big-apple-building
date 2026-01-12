import { useState } from 'react';
import { Building2, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface BuildingRecordsSectionProps {
  billingBbl?: string | null;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function BuildingRecordsSection({ 
  billingBbl, 
  children,
  defaultOpen = true 
}: BuildingRecordsSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-muted">
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
                <Building2 className="h-4 w-4" />
                Building Records (Context Only)
                {billingBbl && (
                  <Badge variant="outline" className="font-mono text-xs ml-2">
                    BBL: {billingBbl}
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {isOpen ? 'Collapse' : 'Expand'}
                </Badge>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Context explanation */}
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 text-sm text-muted-foreground">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                These records are issued at the building level and may apply to common areas or shared systems. 
                They do not necessarily indicate issues specific to this unit.
              </p>
            </div>
            
            {/* Building data cards */}
            <div className="opacity-80">
              {children}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
