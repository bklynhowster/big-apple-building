import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { RecordCounts } from './RiskSnapshotCard';

interface DiagnosticMatrixProps {
  unitBbl?: string | null;
  buildingBbl: string;
  bin?: string;
  recordCounts: RecordCounts;
  // These would be the counts from queries by different identifiers
  // In a real implementation, you'd need to fetch these separately
  unitBblCounts?: Partial<RecordCounts>;
  buildingBblCounts?: Partial<RecordCounts>;
  binCounts?: Partial<RecordCounts>;
}

const DATASET_ROWS = [
  { key: 'dobViolations', label: 'DOB Violations', binQuery: true },
  { key: 'ecbViolations', label: 'ECB Violations', binQuery: true },
  { key: 'dobPermits', label: 'DOB Permits', binQuery: true },
  { key: 'hpdViolations', label: 'HPD Violations', binQuery: false },
  { key: 'hpdComplaints', label: 'HPD Complaints', binQuery: false },
  { key: 'serviceRequests', label: '311 Service Requests', binQuery: false },
] as const;

export function UnitMentionsDiagnosticMatrix({
  unitBbl,
  buildingBbl,
  bin,
  recordCounts,
  unitBblCounts,
  buildingBblCounts,
  binCounts,
}: DiagnosticMatrixProps) {
  // For now, we show the current counts and placeholders for what
  // would be returned by different query strategies
  const matrixData = useMemo(() => {
    return DATASET_ROWS.map(row => {
      const key = row.key as keyof RecordCounts;
      return {
        dataset: row.label,
        unitBbl: unitBblCounts?.[key] ?? '—',
        buildingBbl: buildingBblCounts?.[key] ?? recordCounts[key] ?? 0,
        bin: row.binQuery ? (binCounts?.[key] ?? '—') : 'N/A',
        current: recordCounts[key] ?? 0,
      };
    });
  }, [recordCounts, unitBblCounts, buildingBblCounts, binCounts]);
  
  const hasUnitData = matrixData.some(row => 
    typeof row.unitBbl === 'number' && row.unitBbl > 0
  );
  
  return (
    <Card className="border-dashed border-yellow-500/50 bg-yellow-500/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-yellow-600">
            🔧 Debug: Dataset Query Diagnostic Matrix
          </CardTitle>
          <Badge variant="outline" className="text-xs">debug=1</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Shows record counts by query identifier. Helps identify which datasets support unit-level queries.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Dataset</TableHead>
                <TableHead className="text-xs text-center">
                  Unit BBL
                  {unitBbl && (
                    <div className="text-[10px] font-normal text-muted-foreground truncate max-w-[80px]">
                      {unitBbl}
                    </div>
                  )}
                </TableHead>
                <TableHead className="text-xs text-center">
                  Building BBL
                  <div className="text-[10px] font-normal text-muted-foreground truncate max-w-[80px]">
                    {buildingBbl}
                  </div>
                </TableHead>
                <TableHead className="text-xs text-center">
                  BIN
                  {bin && (
                    <div className="text-[10px] font-normal text-muted-foreground">
                      {bin}
                    </div>
                  )}
                </TableHead>
                <TableHead className="text-xs text-center">Current</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrixData.map((row) => (
                <TableRow key={row.dataset}>
                  <TableCell className="text-xs font-medium">{row.dataset}</TableCell>
                  <TableCell className="text-center">
                    {typeof row.unitBbl === 'number' ? (
                      <Badge 
                        variant={row.unitBbl > 0 ? 'default' : 'secondary'} 
                        className="text-xs"
                      >
                        {row.unitBbl}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">{row.unitBbl}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge 
                      variant={typeof row.buildingBbl === 'number' && row.buildingBbl > 0 ? 'default' : 'secondary'} 
                      className="text-xs"
                    >
                      {row.buildingBbl}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {row.bin === 'N/A' ? (
                      <span className="text-xs text-muted-foreground">N/A</span>
                    ) : typeof row.bin === 'number' ? (
                      <Badge 
                        variant={row.bin > 0 ? 'default' : 'secondary'} 
                        className="text-xs"
                      >
                        {row.bin}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">{row.bin}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="text-xs">
                      {row.current}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        
        <div className="mt-3 pt-3 border-t border-dashed space-y-1">
          <p className="text-xs text-muted-foreground">
            <strong>Legend:</strong> "—" = not queried; "N/A" = dataset doesn't support this identifier
          </p>
          {hasUnitData && (
            <p className="text-xs text-green-600">
              ✓ Some datasets return results for unitBBL — these can be promoted to "Unit-specific records"
            </p>
          )}
          {!hasUnitData && unitBbl && (
            <p className="text-xs text-yellow-600">
              ⚠ No datasets returned results for unitBBL. Unit mentions are inferred from text extraction only.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
