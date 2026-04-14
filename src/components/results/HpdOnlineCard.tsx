/**
 * HpdOnlineCard (HPD Programs & Status)
 *
 * Consolidated HPD program summary powered by NYC Open Data (Socrata):
 *   - HPD Registration + owner/officer/agent/site manager contacts
 *   - Alternative Enforcement Program (AEP) history and current status
 *   - Vacate Orders (active + historical)
 *   - Certificate of No Harassment (CONH) pilot program status
 *   - Annual Bed Bug Reports (Local Law 69)
 *   - Housing Litigation case history
 *   - Archival Images (I-Cards) deep-link — the only program data not in Open Data
 */
import {
  ExternalLink, User, Building2, Info, ShieldAlert, Ban, FileCheck2, Bug, Gavel, FileImage,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useHpdPrograms } from '@/hooks/useHpdPrograms';
import { buildHpdOnlineUrl } from '@/utils/hpdProgramsDirect';
import type {
  HpdContact, AepRecord, VacateOrderRecord, ConhRecord, BedBugReport, LitigationRecord,
} from '@/utils/hpdProgramsDirect';
import { cn } from '@/lib/utils';

interface HpdOnlineCardProps {
  bbl: string;
  address: string;
  borough: string;
}

function contactName(c: HpdContact): string {
  if (c.corporationName) return c.corporationName;
  const parts = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return parts || '—';
}

function contactAddress(c: HpdContact): string | null {
  const parts = [
    [c.businessHouseNumber, c.businessStreetName].filter(Boolean).join(' '),
    [c.businessCity, c.businessState].filter(Boolean).join(', '),
    c.businessZip,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function pickContact(contacts: HpdContact[], types: string[]): HpdContact | null {
  for (const t of types) {
    const hit = contacts.find((c) => (c.type || '').toLowerCase() === t.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function isRegistrationCurrent(registrationEndDate: string | null): boolean {
  if (!registrationEndDate) return false;
  try {
    return new Date(registrationEndDate) >= new Date();
  } catch {
    return false;
  }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

// Derive current AEP status — latest record wins
function summarizeAep(aep: AepRecord[]): { active: boolean; status: string; subtitle: string } | null {
  if (!aep.length) return null;
  const latest = aep[0];
  const active = (latest.currentStatus || '').toLowerCase().includes('active');
  const parts: string[] = [];
  if (latest.aepRound) parts.push(latest.aepRound);
  if (latest.aepStartDate) parts.push(`since ${formatDate(latest.aepStartDate)}`);
  return {
    active,
    status: latest.currentStatus || 'Listed',
    subtitle: parts.join(' · '),
  };
}

function summarizeVacate(orders: VacateOrderRecord[]): { active: number; total: number; latestReason: string | null } {
  const active = orders.filter((o) => o.isActive).length;
  const latest = orders[0];
  return { active, total: orders.length, latestReason: latest?.primaryReason || null };
}

function summarizeConh(conh: ConhRecord | null): { on: boolean; reasons: string[] } {
  if (!conh) return { on: false, reasons: [] };
  const reasons: string[] = [];
  if (conh.aepOrder) reasons.push('AEP');
  if (conh.hpdVacateOrder) reasons.push('HPD Vacate');
  if (conh.dobVacateOrder) reasons.push('DOB Vacate');
  if (conh.harassmentFinding) reasons.push('Harassment Finding');
  if (conh.discharged7a) reasons.push('7A Discharged');
  return { on: true, reasons };
}

function summarizeBedBugs(reports: BedBugReport[]): {
  latestPeriod: string | null;
  infested: number;
  eradicated: number;
  reInfested: number;
  years: number;
} {
  if (!reports.length) return { latestPeriod: null, infested: 0, eradicated: 0, reInfested: 0, years: 0 };
  const latest = reports[0];
  return {
    latestPeriod: latest.periodEnd ? formatDate(latest.periodEnd) : null,
    infested: latest.infestedUnits || 0,
    eradicated: latest.eradicatedUnits || 0,
    reInfested: latest.reInfestedUnits || 0,
    years: reports.length,
  };
}

function summarizeLitigation(cases: LitigationRecord[]): { open: number; closed: number; total: number; latestType: string | null } {
  const open = cases.filter((c) => c.isOpen).length;
  const closed = cases.length - open;
  return {
    open,
    closed,
    total: cases.length,
    latestType: cases[0]?.caseType || null,
  };
}

export function HpdOnlineCard({ bbl, address, borough }: HpdOnlineCardProps) {
  const { loading, registration, contacts, aep, vacateOrders, conh, bedBugReports, litigation, error } =
    useHpdPrograms(bbl);

  const buildingId = registration?.buildingId || null;
  const overviewUrl = buildHpdOnlineUrl(address, borough, buildingId);

  const owner = pickContact(contacts, ['IndividualOwner', 'CorporateOwner', 'JointOwner']);
  const headOfficer = pickContact(contacts, ['HeadOfficer']);
  const agent = pickContact(contacts, ['Agent']);
  const siteManager = pickContact(contacts, ['SiteManager']);

  const current = isRegistrationCurrent(registration?.registrationEndDate || null);
  const aepSummary = summarizeAep(aep);
  const vacateSummary = summarizeVacate(vacateOrders);
  const conhSummary = summarizeConh(conh);
  const bbSummary = summarizeBedBugs(bedBugReports);
  const litSummary = summarizeLitigation(litigation);

  return (
    <Card id="scroll-hpd-programs">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Building2 className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">HPD Programs &amp; Status</CardTitle>
          {loading ? (
            <Skeleton className="h-5 w-24" />
          ) : registration ? (
            <Badge
              variant="secondary"
              className={current ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}
            >
              {current ? 'Registered' : 'Registration Expired'}
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-muted text-muted-foreground">
              Not HPD-Registered
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div className="text-xs text-destructive">Failed to load HPD data: {error}</div>
        )}

        {/* Registration row */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : registration ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="border border-border rounded-md p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Registration ID</div>
              <div className="font-mono">{registration.registrationId || '—'}</div>
            </div>
            <div className="border border-border rounded-md p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Last Registered</div>
              <div>{formatDate(registration.lastRegistrationDate) || '—'}</div>
            </div>
            <div className="border border-border rounded-md p-3">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Expires</div>
              <div>{formatDate(registration.registrationEndDate) || '—'}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground flex items-start gap-2 bg-muted/30 border border-border rounded-md p-3">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              No HPD registration on file. Registration is only required for buildings
              with 3+ units or non-owner-occupied rentals.
            </div>
          </div>
        )}

        {/* Contacts */}
        {(owner || headOfficer || agent || siteManager) && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Registered Contacts
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {owner && <ContactTile label="Owner" contact={owner} />}
              {headOfficer && <ContactTile label="Head Officer" contact={headOfficer} />}
              {agent && <ContactTile label="Managing Agent" contact={agent} />}
              {siteManager && <ContactTile label="Site Manager" contact={siteManager} />}
            </div>
          </div>
        )}

        {/* Program data tiles — real counts from Socrata */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">HPD Programs & Orders</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {/* AEP */}
            <ProgramTile
              icon={<ShieldAlert className="h-4 w-4" />}
              label="AEP"
              tone={aepSummary?.active ? 'bad' : aepSummary ? 'warn' : 'neutral'}
              primary={aepSummary ? aepSummary.status : 'Not in program'}
              secondary={aepSummary?.subtitle || 'Alternative Enforcement Program'}
            />

            {/* Vacate Orders */}
            <ProgramTile
              icon={<Ban className="h-4 w-4" />}
              label="Vacate Orders"
              tone={vacateSummary.active > 0 ? 'bad' : vacateSummary.total > 0 ? 'warn' : 'neutral'}
              primary={
                vacateSummary.active > 0
                  ? `${vacateSummary.active} active`
                  : vacateSummary.total > 0
                    ? `${vacateSummary.total} rescinded`
                    : 'None on record'
              }
              secondary={vacateSummary.latestReason ? `Latest: ${vacateSummary.latestReason}` : undefined}
            />

            {/* CONH */}
            <ProgramTile
              icon={<FileCheck2 className="h-4 w-4" />}
              label="CONH"
              tone={conhSummary.on ? 'warn' : 'neutral'}
              primary={conhSummary.on ? 'On CONH list' : 'Not on list'}
              secondary={conhSummary.reasons.length ? `Due to: ${conhSummary.reasons.join(', ')}` : 'Cert. of No Harassment'}
            />

            {/* Bed Bug Reports */}
            <ProgramTile
              icon={<Bug className="h-4 w-4" />}
              label="Bed Bug Reports"
              tone={bbSummary.infested > 0 ? 'warn' : 'neutral'}
              primary={
                bbSummary.years === 0
                  ? 'Not filed'
                  : bbSummary.infested > 0
                    ? `${bbSummary.infested} infested unit${bbSummary.infested === 1 ? '' : 's'}`
                    : 'No infestations reported'
              }
              secondary={
                bbSummary.years > 0
                  ? `${bbSummary.years} annual filing${bbSummary.years === 1 ? '' : 's'} · latest ${bbSummary.latestPeriod || '—'}`
                  : 'Local Law 69 annual disclosure'
              }
            />

            {/* Litigation */}
            <ProgramTile
              icon={<Gavel className="h-4 w-4" />}
              label="Housing Litigation"
              tone={litSummary.open > 0 ? 'bad' : litSummary.total > 0 ? 'warn' : 'neutral'}
              primary={
                litSummary.total === 0
                  ? 'None on record'
                  : `${litSummary.open} open · ${litSummary.closed} closed`
              }
              secondary={litSummary.latestType ? `Latest: ${litSummary.latestType}` : undefined}
            />

            {/* I-Cards (deep-link, no Open Data) */}
            <a
              href={overviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group border border-border rounded-md p-3 hover:bg-muted/50 hover:border-primary/40 transition-colors flex flex-col gap-1"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-primary"><FileImage className="h-4 w-4" /></span>
                <span>Archival Images</span>
                <ExternalLink className="h-3 w-3 ml-auto text-muted-foreground group-hover:text-primary" />
              </div>
              <div className="text-[11px] text-muted-foreground">
                Pre-1987 I-Cards · external lookup
              </div>
            </a>
          </div>
        </div>

        {/* Active vacate detail */}
        {vacateSummary.active > 0 && (
          <div className="border border-destructive/30 bg-destructive/5 rounded-md p-3 space-y-2">
            <div className="text-sm font-medium text-destructive flex items-center gap-1.5">
              <Ban className="h-4 w-4" /> Active Vacate Orders
            </div>
            <div className="space-y-1.5 text-xs">
              {vacateOrders.filter((o) => o.isActive).map((o) => (
                <div key={o.orderNumber || Math.random()} className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="font-mono text-muted-foreground">#{o.orderNumber || '—'}</span>
                  {o.vacateType && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{o.vacateType}</Badge>}
                  {o.primaryReason && <span>{o.primaryReason}</span>}
                  {o.effectiveDate && <span className="text-muted-foreground">· effective {formatDate(o.effectiveDate)}</span>}
                  {o.numberOfVacatedUnits != null && <span className="text-muted-foreground">· {o.numberOfVacatedUnits} unit{o.numberOfVacatedUnits === 1 ? '' : 's'}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ContactTile({ label, contact }: { label: string; contact: HpdContact }) {
  const addr = contactAddress(contact);
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</div>
      <div className="font-medium text-sm">{contactName(contact)}</div>
      {addr && <div className="text-xs text-muted-foreground mt-1">{addr}</div>}
    </div>
  );
}

function ProgramTile({
  icon,
  label,
  primary,
  secondary,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary?: string;
  tone?: 'neutral' | 'warn' | 'bad';
}) {
  const toneClasses = {
    neutral: 'border-border',
    warn: 'border-warning/40 bg-warning/5',
    bad: 'border-destructive/40 bg-destructive/5',
  }[tone];
  const primaryTone = {
    neutral: 'text-foreground',
    warn: 'text-warning',
    bad: 'text-destructive',
  }[tone];
  return (
    <div className={cn('border rounded-md p-3 flex flex-col gap-1', toneClasses)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className={cn('text-sm font-medium', primaryTone)}>{primary}</div>
      {secondary && <div className="text-[11px] text-muted-foreground">{secondary}</div>}
    </div>
  );
}
