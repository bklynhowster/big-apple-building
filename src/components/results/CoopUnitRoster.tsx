/**
 * Co-op Unit Roster — powered by ACRIS data.
 *
 * Shows all known units in a co-op building with last transaction
 * details (date, price, buyer/seller) derived from ACRIS filings.
 */

import { useEffect, useState, useMemo } from 'react';
import { Building2, Search, AlertCircle, Loader2, ChevronDown, ChevronUp, DollarSign, Calendar, Users, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAcrisUnitRoster, type AcrisUnit, type AcrisTransaction } from '@/hooks/useAcrisUnitRoster';
import { cn } from '@/lib/utils';

interface CoopUnitRosterProps {
  bbl: string;
  totalUnits?: number; // from PLUTO unitsres
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function truncateName(name: string, max: number = 28): string {
  if (name.length <= max) return name;
  return name.substring(0, max - 1) + '…';
}

function TransactionRow({ tx }: { tx: AcrisTransaction }) {
  const buyers = tx.parties.filter((p) => p.role === 'buyer');
  const sellers = tx.parties.filter((p) => p.role === 'seller');

  return (
    <div className="flex flex-col gap-1 py-2 px-3 border-b last:border-0 text-sm">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="text-xs font-normal shrink-0">
          {tx.docType}
        </Badge>
        <span className="text-muted-foreground text-xs">
          {formatDate(tx.recordedDate || tx.documentDate)}
        </span>
        {tx.amount && tx.amount > 0 ? (
          <span className="font-medium text-green-700 dark:text-green-400">
            {formatCurrency(tx.amount)}
          </span>
        ) : null}
      </div>
      {sellers.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="text-red-600 dark:text-red-400 font-medium">Seller:</span>{' '}
          {sellers.map((p) => p.name).join(', ')}
        </div>
      )}
      {buyers.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="text-blue-600 dark:text-blue-400 font-medium">Buyer:</span>{' '}
          {buyers.map((p) => p.name).join(', ')}
        </div>
      )}
    </div>
  );
}

function UnitRow({ unit }: { unit: AcrisUnit }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell className="font-medium">
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            {unit.unit}
          </div>
        </TableCell>
        <TableCell>
          {unit.lastSaleAmount ? (
            <span className="font-medium">{formatCurrency(unit.lastSaleAmount)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell>
          <span className="text-sm">{formatDate(unit.lastTransactionDate)}</span>
        </TableCell>
        <TableCell className="max-w-[200px]">
          {unit.lastBuyer ? (
            <span className="text-sm truncate block" title={unit.lastBuyer}>
              {truncateName(unit.lastBuyer)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="text-center">
          <Badge variant="secondary" className="text-xs">
            {unit.transactionCount}
          </Badge>
        </TableCell>
        <TableCell className="w-8">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="p-0 bg-muted/30">
            <div className="max-h-64 overflow-y-auto">
              {unit.transactions.map((tx) => (
                <TransactionRow key={tx.documentId} tx={tx} />
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function MobileUnitCard({ unit }: { unit: AcrisUnit }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-hidden">
      <div
        className="p-3 cursor-pointer hover:bg-muted/50 flex items-center justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-base">{unit.unit}</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {unit.transactionCount} records
          </Badge>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      <div className="px-3 pb-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-muted-foreground text-xs">Last Sale</span>
          <div className="font-medium">
            {unit.lastSaleAmount ? formatCurrency(unit.lastSaleAmount) : '—'}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground text-xs">Date</span>
          <div>{formatDate(unit.lastTransactionDate)}</div>
        </div>
        {unit.lastBuyer && (
          <div className="col-span-2">
            <span className="text-muted-foreground text-xs">Current Owner</span>
            <div className="text-sm truncate" title={unit.lastBuyer}>{unit.lastBuyer}</div>
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t">
          {unit.transactions.map((tx) => (
            <TransactionRow key={tx.documentId} tx={tx} />
          ))}
        </div>
      )}
    </Card>
  );
}

export function CoopUnitRoster({ bbl, totalUnits }: CoopUnitRosterProps) {
  const { loading, error, units, totalDocuments, fetch: fetchRoster } = useAcrisUnitRoster();
  const [searchTerm, setSearchTerm] = useState('');

  // Auto-fetch on mount / BBL change
  useEffect(() => {
    if (bbl) {
      fetchRoster(bbl);
    }
  }, [bbl, fetchRoster]);

  // Filter
  const filteredUnits = useMemo(() => {
    if (!searchTerm.trim()) return units;
    const term = searchTerm.toLowerCase();
    return units.filter((u) => {
      if (u.unit.toLowerCase().includes(term)) return true;
      if (u.lastBuyer?.toLowerCase().includes(term)) return true;
      if (u.lastSeller?.toLowerCase().includes(term)) return true;
      return false;
    });
  }, [units, searchTerm]);

  // Detect mobile
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  // Stats
  const unitsWithSales = units.filter((u) => u.lastSaleAmount && u.lastSaleAmount > 0);
  const avgSalePrice =
    unitsWithSales.length > 0
      ? unitsWithSales.reduce((sum, u) => sum + (u.lastSaleAmount || 0), 0) / unitsWithSales.length
      : null;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading unit roster from ACRIS...
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (units.length === 0) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          No ACRIS records found for this building. Unit roster data may not be available for all co-ops.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            Co-op Unit Roster
          </h2>
          <p className="text-sm text-muted-foreground">
            {units.length} units found in ACRIS
            {totalUnits ? ` (of ${totalUnits} residential units)` : ''}
            {' · '}
            {totalDocuments} documents
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search units or names..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-blue-500" />
            <div>
              <div className="text-xs text-muted-foreground">Units Found</div>
              <div className="font-semibold">{units.length}{totalUnits ? ` / ${totalUnits}` : ''}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <FileText className="h-4 w-4 text-purple-500" />
            <div>
              <div className="text-xs text-muted-foreground">ACRIS Docs</div>
              <div className="font-semibold">{totalDocuments}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-500" />
            <div>
              <div className="text-xs text-muted-foreground">Avg Last Sale</div>
              <div className="font-semibold">{avgSalePrice ? formatCurrency(avgSalePrice) : '—'}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-orange-500" />
            <div>
              <div className="text-xs text-muted-foreground">With Sales</div>
              <div className="font-semibold">{unitsWithSales.length}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Source note */}
      <p className="text-xs text-muted-foreground">
        Data from ACRIS (Automated City Register Information System). Shows units with recorded transactions.
        Units without ACRIS filings may not appear. Click any row to expand transaction history.
      </p>

      {/* Table / Cards */}
      {isMobile ? (
        <div className="space-y-3">
          {filteredUnits.map((unit) => (
            <MobileUnitCard key={unit.unit} unit={unit} />
          ))}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Unit</TableHead>
                  <TableHead className="w-32">Last Sale</TableHead>
                  <TableHead className="w-32">Date</TableHead>
                  <TableHead>Current Owner</TableHead>
                  <TableHead className="w-20 text-center">Records</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUnits.map((unit) => (
                  <UnitRow key={unit.unit} unit={unit} />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-sm text-muted-foreground text-center">
        Showing {filteredUnits.length} of {units.length} units
        {searchTerm && ` matching "${searchTerm}"`}
      </div>
    </div>
  );
}
