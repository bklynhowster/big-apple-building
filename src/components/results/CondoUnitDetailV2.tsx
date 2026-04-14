/**
 * CondoUnitDetailV2 — Redesigned condo unit detail page
 *
 * Replaces the old tabbed unit layout with a single-scroll page focused on
 * actionable due diligence data:
 * 1. Tax Status strip (clear, unambiguous)
 * 2. ACRIS Transaction Timeline
 * 3. Unit Violation Mentions (with actual records)
 * 4. Building Context summary
 *
 * Feature-flagged via ?v=2 URL param (same as SingleScrollLayout).
 */

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { RecordExplanation } from './RecordExplanation';
import { HPDTab } from './HPDTab';
import { ECBTab } from './ECBTab';
import { ViolationsTab } from './ViolationsTab';
import { PermitsTab } from './PermitsTab';
import { ThreeOneOneTab } from './ThreeOneOneTab';

import type { PropertyTaxResult } from '@/features/taxes/types';
import type { RecordCounts } from './RiskSnapshotCard';
import type { CombinedUnitStats } from '@/hooks/useUnitMentions';
import type { AcrisUnit, AcrisTransaction } from '@/utils/acrisUnitRoster';

// ─── Helpers ──────────────────────────────────────────────

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysPastDue(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const now = new Date();
  if (isNaN(due.getTime()) || due >= now) return null;
  return Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

function computeEffectiveArrears(taxData: PropertyTaxResult | null): number | null {
  if (!taxData) return null;
  const raw = taxData.arrears;
  if (raw != null && raw > 0) return raw;
  // If unpaid and there's a balance, treat it as outstanding regardless of due date
  if (taxData.payment_status === 'unpaid' && taxData.latest_period_balance != null && taxData.latest_period_balance > 0) {
    return taxData.latest_period_balance;
  }
  return raw;
}

// ─── Types ────────────────────────────────────────────────

interface CondoUnitDetailV2Props {
  // Unit identity
  unitLabel: string | null;
  unitBbl: string;
  buildingBbl: string;
  address: string;
  borough: string;
  bin: string;
  lotNumber?: string | null;

  // Tax data for this unit
  taxData: PropertyTaxResult | null;
  taxLoading: boolean;

  // ACRIS data (all units — we'll filter for this unit)
  acrisUnits: AcrisUnit[];
  acrisLoading: boolean;

  // Unit mention data (for this specific unit)
  unitMentions: CombinedUnitStats | null;
  mentionsScanning: boolean;

  // Building-level record counts (for context strip)
  recordCounts: RecordCounts;

  // Building info
  isCondo: boolean;

  // Location (for 311 queries)
  lat?: number;
  lon?: number;

  // Navigation
  onBackToBuilding: () => void;
}

// ─── Sub-Components ───────────────────────────────────────

function TaxStatusStrip({ taxData, loading }: { taxData: PropertyTaxResult | null; loading: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-4 divide-x divide-border">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="p-4 animate-pulse">
                <div className="h-3 w-12 bg-muted rounded mb-2" />
                <div className="h-6 w-20 bg-muted rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!taxData || taxData.no_data_found) {
    return (
      <Card>
        <CardContent className="p-4 text-center text-muted-foreground text-sm">
          No tax data available for this unit.
        </CardContent>
      </Card>
    );
  }

  const effectiveArrears = computeEffectiveArrears(taxData);
  const hasArrears = effectiveArrears != null && effectiveArrears > 0;
  const pastDueDays = daysPastDue(taxData.latest_due_date);
  const isPaid = taxData.payment_status === 'paid';

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
          {/* Status */}
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Status</div>
            <Badge
              variant="outline"
              className={cn(
                "text-sm font-semibold",
                isPaid && "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800",
                !isPaid && taxData.payment_status === 'unpaid' && "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
                taxData.payment_status === 'unknown' && "bg-muted text-muted-foreground"
              )}
            >
              <span className="mr-1.5">●</span>
              {isPaid ? 'Paid' : taxData.payment_status === 'unpaid' ? 'Unpaid' : 'Unknown'}
            </Badge>
          </div>

          {/* Latest Bill */}
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Latest Bill</div>
            <div className="text-xl font-bold">{formatCurrency(taxData.latest_bill_amount)}</div>
            {taxData.latest_due_date && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Due {formatDate(taxData.latest_due_date)}
              </div>
            )}
          </div>

          {/* Outstanding Balance */}
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {hasArrears ? 'Outstanding' : 'Balance'}
            </div>
            <div className={cn("text-xl font-bold", hasArrears ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400")}>
              {hasArrears ? formatCurrency(effectiveArrears) : '$0'}
            </div>
            {hasArrears && pastDueDays != null && (
              <div className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                {pastDueDays} days past due
              </div>
            )}
            {hasArrears && !pastDueDays && !isPaid && (
              <div className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                Payment due
              </div>
            )}
            {!hasArrears && isPaid && (
              <div className="text-xs text-green-600/80 dark:text-green-400/80 mt-0.5">No outstanding balance</div>
            )}
          </div>

          {/* Billing Cycle */}
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Billing</div>
            <div className="text-base font-semibold">{taxData.billing_cycle || 'Unknown'}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Unit-level bill</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ArrearsAlert({ taxData }: { taxData: PropertyTaxResult }) {
  const effectiveArrears = computeEffectiveArrears(taxData);
  if (!effectiveArrears || effectiveArrears <= 0) return null;

  const pastDueDays = daysPastDue(taxData.latest_due_date);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800 p-3.5 mt-3">
      <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-red-700 dark:text-red-300">
        <strong>Tax arrears: {formatCurrency(effectiveArrears)} outstanding.</strong>
        {pastDueDays != null && (
          <> Latest bill (due {formatDate(taxData.latest_due_date)}) is {pastDueDays} days past due.</>
        )}
        {taxData.arrears_note && (
          <> {taxData.arrears_note}</>
        )}
      </div>
    </div>
  );
}

// Transaction type styling
const DOC_TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  'Deed': { bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-300' },
  'Deed, RP': { bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-300' },
  'Transfer Tax': { bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-300' },
  'Mortgage': { bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300' },
  'Assignment': { bg: 'bg-purple-50 dark:bg-purple-950', text: 'text-purple-700 dark:text-purple-300' },
  'Assignment, Mortgage': { bg: 'bg-purple-50 dark:bg-purple-950', text: 'text-purple-700 dark:text-purple-300' },
  'Agreement': { bg: 'bg-yellow-50 dark:bg-yellow-950', text: 'text-yellow-700 dark:text-yellow-300' },
  'Satisfaction': { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-300' },
  'Satisfaction of Mortgage': { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-300' },
};

function getDocTypeStyle(docType: string) {
  // Try exact match, then partial
  if (DOC_TYPE_STYLES[docType]) return DOC_TYPE_STYLES[docType];
  for (const [key, style] of Object.entries(DOC_TYPE_STYLES)) {
    if (docType.toLowerCase().includes(key.toLowerCase())) return style;
  }
  return { bg: 'bg-muted', text: 'text-muted-foreground' };
}

function TransactionTimeline({ transactions, loading }: { transactions: AcrisTransaction[]; loading: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-4">
                <div className="h-3 w-3 rounded-full bg-muted mt-1" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-muted rounded" />
                  <div className="h-3 w-32 bg-muted rounded" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!transactions.length) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          No ACRIS transaction records found for this unit.
        </CardContent>
      </Card>
    );
  }

  // Compute summary stats
  const sales = transactions.filter(t =>
    t.docType?.toLowerCase().includes('deed') || t.docType?.toLowerCase().includes('transfer')
  );
  const saleAmounts = sales.map(t => t.amount).filter((a): a is number => a != null && a > 0);
  const priceMin = saleAmounts.length ? Math.min(...saleAmounts) : null;
  const priceMax = saleAmounts.length ? Math.max(...saleAmounts) : null;
  const priceTrend = priceMin && priceMax && priceMin !== priceMax
    ? `${Math.round(((priceMax - priceMin) / priceMin) * 100)}%`
    : null;

  return (
    <Card>
      <CardContent className="p-5">
        {/* Timeline */}
        <div className="relative pl-7">
          <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-border" />
          {transactions.map((tx, i) => {
            const isSale = tx.docType?.toLowerCase().includes('deed') || tx.docType?.toLowerCase().includes('transfer');
            const style = getDocTypeStyle(tx.docType || '');
            const buyers = tx.parties?.filter(p => p.role === 'buyer') || [];
            const sellers = tx.parties?.filter(p => p.role === 'seller') || [];

            return (
              <div key={tx.documentId || i} className={cn("relative pb-5 last:pb-0")}>
                {/* Dot */}
                <div className={cn(
                  "absolute -left-7 top-1.5 w-3 h-3 rounded-full border-2 z-10",
                  isSale
                    ? "bg-amber-600 border-amber-600 dark:bg-amber-400 dark:border-amber-400"
                    : "bg-background border-muted-foreground/40"
                )} />

                {/* Content */}
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded", style.bg, style.text)}>
                      {tx.docType || 'Unknown'}
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {formatDate(tx.recordedDate || tx.documentDate)}
                    </span>
                  </div>
                  {tx.amount != null && tx.amount > 0 && (
                    <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                      {formatCurrency(tx.amount)}
                    </span>
                  )}
                </div>

                {/* Parties */}
                {(buyers.length > 0 || sellers.length > 0) && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {buyers.length > 0 && sellers.length > 0 ? (
                      <>
                        <span className="font-medium text-foreground">{buyers[0].name}</span>
                        {' bought from '}
                        <span className="font-medium text-foreground">{sellers[0].name}</span>
                      </>
                    ) : buyers.length > 0 ? (
                      <>Buyer: <span className="font-medium text-foreground">{buyers[0].name}</span></>
                    ) : sellers.length > 0 ? (
                      <>Seller: <span className="font-medium text-foreground">{sellers[0].name}</span></>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Summary line */}
        {sales.length > 0 && (
          <div className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border text-right">
            {sales.length} sale{sales.length !== 1 ? 's' : ''} on record
            {priceTrend && priceMin && priceMax && (
              <> · Price range: {formatCurrency(priceMin)} → {formatCurrency(priceMax)} ({priceTrend})</>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Record type styling for violation mentions
const RECORD_TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  'hpd': { bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-300', label: 'HPD' },
  'ecb': { bg: 'bg-pink-50 dark:bg-pink-950', text: 'text-pink-700 dark:text-pink-300', label: 'ECB' },
  'dob-violation': { bg: 'bg-indigo-50 dark:bg-indigo-950', text: 'text-indigo-700 dark:text-indigo-300', label: 'DOB' },
  '311': { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-600 dark:text-gray-300', label: '311' },
  'permit': { bg: 'bg-teal-50 dark:bg-teal-950', text: 'text-teal-700 dark:text-teal-300', label: 'Permit' },
  'dob': { bg: 'bg-indigo-50 dark:bg-indigo-950', text: 'text-indigo-700 dark:text-indigo-300', label: 'DOB' },
  'sales': { bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-300', label: 'Sales' },
};

function UnitMentionsSection({ mentions, scanning, unitLabel }: { mentions: CombinedUnitStats | null; scanning: boolean; unitLabel?: string | null }) {
  // Count chips
  const counts = mentions ? [
    { key: 'hpd', label: 'HPD', count: mentions.hpdCount },
    { key: 'ecb', label: 'ECB', count: mentions.ecbViolationsCount },
    { key: 'dob', label: 'DOB', count: mentions.dobViolationsCount },
    { key: '311', label: '311', count: mentions.threeOneOneCount },
    { key: 'permits', label: 'Permits', count: mentions.permitsCount },
    { key: 'filings', label: 'Filings', count: mentions.filingsCount },
  ] : [];

  const totalCount = mentions?.totalCount ?? 0;

  // Collect all violation/permit refs for display
  const allRefs = [
    ...(mentions?.violationRefs?.map(r => ({
      type: r.type,
      id: r.id,
      date: r.issueDate,
      description: r.description,
      status: r.status,
      label: r.label,
      snippet: r.snippet,
      raw: r,
    })) || []),
    ...(mentions?.permitRefs?.map(r => ({
      type: 'permit' as const,
      id: r.id,
      date: r.issueDate,
      description: r.description,
      status: r.status,
      label: r.label,
      snippet: r.snippet,
      raw: r,
    })) || []),
    // HPD sourceRefs
    ...(mentions?.sourceRefs?.filter(s => s.type === 'hpd').map(s => ({
      type: 'hpd' as const,
      id: s.id,
      date: null as string | null,
      description: s.label,
      status: '',
      label: s.label,
      snippet: null as string | null,
      raw: s,
    })) || []),
  ].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return (
    <div className="space-y-3">
      {/* Count chips */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {(scanning && !mentions) ? (
          [1,2,3,4,5,6].map(i => (
            <div key={i} className="rounded-lg border border-border bg-card p-3 text-center animate-pulse">
              <div className="h-6 w-8 bg-muted rounded mx-auto mb-1" />
              <div className="h-3 w-10 bg-muted rounded mx-auto" />
            </div>
          ))
        ) : (
          counts.map(c => (
            <div key={c.key} className="rounded-lg border border-border bg-card p-3 text-center">
              <div className={cn("text-xl font-bold", c.count > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground/40")}>
                {c.count}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
                {c.label}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Records list */}
      <Card>
        {totalCount === 0 && !scanning ? (
          <CardContent className="p-6 text-center">
            <div className="text-2xl mb-2">✓</div>
            <div className="text-sm text-muted-foreground">
              No enforcement records specifically reference Unit {mentions?.unit || unitLabel || '—'}.
            </div>
            <div className="text-xs text-muted-foreground/70 mt-2 max-w-md mx-auto leading-relaxed">
              NYC violations, permits, and 311 complaints are typically filed at the building level
              for condos — not per unit. Check the Building Context below for building-wide records
              that may affect this unit.
            </div>
          </CardContent>
        ) : scanning && !mentions ? (
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            Scanning building records for unit mentions...
          </CardContent>
        ) : (
          <CardContent className="p-0 divide-y divide-border">
            {allRefs.slice(0, 15).map((ref, i) => {
              const typeStyle = RECORD_TYPE_STYLES[ref.type] || RECORD_TYPE_STYLES['dob'];
              const isOpen = ref.status?.toLowerCase() === 'open';
              const isClosed = ref.status?.toLowerCase() === 'closed' ||
                ref.status?.toLowerCase() === 'resolve' ||
                ref.status?.toLowerCase() === 'resolved';

              return (
                <div key={`${ref.type}-${ref.id}-${i}`} className="p-3.5">
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-xs text-muted-foreground whitespace-nowrap min-w-[70px] pt-0.5">
                      {ref.date ? formatDate(ref.date) : '—'}
                    </span>
                    <span className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap", typeStyle.bg, typeStyle.text)}>
                      {typeStyle.label}
                    </span>
                    <span className="text-sm flex-1 leading-snug">
                      {ref.description || ref.label || 'No description'}
                    </span>
                    {(isOpen || isClosed) && (
                      <span className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap",
                        isOpen && "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
                        isClosed && "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                      )}>
                        {isOpen ? 'Open' : 'Closed'}
                      </span>
                    )}
                  </div>
                  {ref.snippet && (
                    <div className="text-xs text-muted-foreground mt-1 ml-[86px] italic">
                      Mention: "{ref.snippet}"
                    </div>
                  )}
                </div>
              );
            })}
            {allRefs.length > 15 && (
              <div className="p-3 text-center text-xs text-muted-foreground">
                + {allRefs.length - 15} more records
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function BuildingContextStrip({ counts, onBackToBuilding }: { counts: RecordCounts; onBackToBuilding?: () => void }) {
  const cells = [
    {
      label: 'Open Violations',
      value: (counts.hpdViolationsOpen ?? 0) + (counts.ecbViolationsOpen ?? 0) + (counts.dobViolationsOpen ?? 0),
      sub: 'HPD + ECB + DOB',
      warn: true,
    },
    { label: 'HPD Records', value: counts.hpdViolations, sub: 'violations' },
    { label: 'ECB Violations', value: counts.ecbViolations, sub: 'all time' },
    { label: 'DOB Violations', value: counts.dobViolations ?? 0, sub: 'all time' },
    { label: 'Permits', value: counts.dobPermits, sub: 'active & closed' },
    { label: '311 Complaints', value: counts.serviceRequests ?? 0, sub: 'nearby' },
  ];

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-border">
          {cells.map(c => (
            <div key={c.label} className="p-3 text-center">
              <div className={cn(
                "text-xl font-bold",
                c.warn && c.value > 0 ? "text-red-600 dark:text-red-400" :
                  c.value === 0 ? "text-green-600 dark:text-green-400" : "text-foreground"
              )}>
                {c.value}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-0.5">
                {c.label}
              </div>
              <div className="text-[10px] text-muted-foreground/60">{c.sub}</div>
            </div>
          ))}
        </div>
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between bg-muted/30">
          <p className="text-xs text-muted-foreground">
            These are building-wide records. Permits, violations, and 311 complaints apply to the entire property.
          </p>
          {onBackToBuilding && (
            <Button variant="ghost" size="sm" onClick={onBackToBuilding} className="text-xs gap-1 shrink-0">
              View building details <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Building Records (expandable) ───────────────────────

function CollapsibleRecordSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-accent/50 transition-colors"
      >
        <span className="text-sm font-semibold flex items-center gap-2">
          {title}
          <Badge variant="secondary" className="text-xs font-mono">{count}</Badge>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border">
          {children}
        </div>
      )}
    </div>
  );
}

function BuildingRecordsSection({ buildingBbl, bin, lat, lon, address, recordCounts }: {
  buildingBbl: string;
  bin: string;
  lat?: number;
  lon?: number;
  address: string;
  recordCounts: RecordCounts;
}) {
  const hasAnyRecords = (recordCounts.hpdViolations ?? 0) > 0
    || (recordCounts.ecbViolations ?? 0) > 0
    || (recordCounts.dobViolations ?? 0) > 0
    || (recordCounts.dobPermits ?? 0) > 0
    || (recordCounts.serviceRequests ?? 0) > 0;

  if (!hasAnyRecords) return null;

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-2">
        📋 Building-Wide Records
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        These records are filed at the building level by NYC agencies. Expand any section to see details.
      </p>
      <div className="space-y-2">
        {(recordCounts.hpdViolations ?? 0) > 0 && (
          <CollapsibleRecordSection title="HPD Violations & Complaints" count={recordCounts.hpdViolations ?? 0}>
            <HPDTab bbl={buildingBbl} bin={bin} address={address} scope="building" />
          </CollapsibleRecordSection>
        )}
        {(recordCounts.ecbViolations ?? 0) > 0 && (
          <CollapsibleRecordSection title="ECB Violations" count={recordCounts.ecbViolations ?? 0}>
            <ECBTab bbl={buildingBbl} bin={bin} address={address} scope="building" />
          </CollapsibleRecordSection>
        )}
        {(recordCounts.dobViolations ?? 0) > 0 && (
          <CollapsibleRecordSection title="DOB Violations" count={recordCounts.dobViolations ?? 0}>
            <ViolationsTab bbl={buildingBbl} bin={bin} address={address} scope="building" />
          </CollapsibleRecordSection>
        )}
        {(recordCounts.dobPermits ?? 0) > 0 && (
          <CollapsibleRecordSection title="DOB Permits" count={recordCounts.dobPermits ?? 0}>
            <PermitsTab bbl={buildingBbl} bin={bin} address={address} scope="building" />
          </CollapsibleRecordSection>
        )}
        {(recordCounts.serviceRequests ?? 0) > 0 && lat !== undefined && lon !== undefined && (
          <CollapsibleRecordSection title="311 Complaints" count={recordCounts.serviceRequests ?? 0}>
            <ThreeOneOneTab lat={lat} lon={lon} address={address} scope="building" />
          </CollapsibleRecordSection>
        )}
      </div>
    </section>
  );
}

// ─── Main Component ───────────────────────────────────────

export function CondoUnitDetailV2({
  unitLabel,
  unitBbl,
  buildingBbl,
  address,
  borough,
  bin,
  lotNumber,
  taxData,
  taxLoading,
  acrisUnits,
  acrisLoading,
  unitMentions,
  mentionsScanning,
  recordCounts,
  isCondo,
  lat,
  lon,
  onBackToBuilding,
}: CondoUnitDetailV2Props) {

  // Find ACRIS transactions for this specific unit
  const unitTransactions = useMemo(() => {
    if (!unitLabel || !acrisUnits.length) return [];
    const normalizedLabel = unitLabel.toUpperCase().replace(/\s+/g, '');
    const match = acrisUnits.find(u =>
      u.unit.toUpperCase().replace(/\s+/g, '') === normalizedLabel
    );
    return match?.transactions || [];
  }, [unitLabel, acrisUnits]);

  // Lot number from BBL
  const lot = lotNumber || (unitBbl.length === 10 ? unitBbl.slice(6) : null);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        onClick={onBackToBuilding}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {address}
      </button>

      {/* Unit Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Unit {unitLabel || lot || '—'}
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">{address} — {borough}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 font-semibold">
            Condo
          </Badge>
          <Badge variant="outline" className="font-mono text-xs">BBL {unitBbl}</Badge>
          {bin && <Badge variant="outline" className="font-mono text-xs">BIN {bin}</Badge>}
          {lot && <Badge variant="outline" className="font-mono text-xs">Lot {lot}</Badge>}
        </div>
      </div>

      {/* 1. Tax Status */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-2">
          <span>$</span> Tax Status
        </h2>
        <TaxStatusStrip taxData={taxData} loading={taxLoading} />
        {taxData && <ArrearsAlert taxData={taxData} />}
        {taxData && !taxData.no_data_found && (
          <div className="mt-2 text-xs text-muted-foreground flex flex-col gap-1.5">
            <a
              href={`https://a836-pts-access.nyc.gov/care/search/commonsearch.aspx?mode=persprop`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              View full payment history on NYC DOF →
            </a>
            <span className="text-muted-foreground/60">
              Search for BBL {unitBbl} (Borough {unitBbl.slice(0,1)}, Block {unitBbl.slice(1,6)}, Lot {unitBbl.slice(6)})
            </span>
          </div>
        )}
      </section>

      {/* 2. Transaction History */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-2">
          📋 Transaction History (ACRIS)
        </h2>
        <TransactionTimeline transactions={unitTransactions} loading={acrisLoading} />
      </section>

      {/* 3. Unit Violation Mentions */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-2">
          🔍 Records Mentioning This Unit
        </h2>
        <UnitMentionsSection mentions={unitMentions} scanning={mentionsScanning} unitLabel={unitLabel} />
      </section>

      {/* 4. Building Context */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-2">
          🏢 Building Context
        </h2>
        <BuildingContextStrip counts={recordCounts} onBackToBuilding={onBackToBuilding} />
      </section>

      {/* 5. Building-Wide Records — the full data behind the counts above */}
      <BuildingRecordsSection
        buildingBbl={buildingBbl}
        bin={bin}
        lat={lat}
        lon={lon}
        address={address}
        recordCounts={recordCounts}
      />
    </div>
  );
}
