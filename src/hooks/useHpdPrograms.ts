import { useEffect, useState } from 'react';
import {
  fetchHpdRegistration,
  fetchHpdContacts,
  fetchAep,
  fetchVacateOrders,
  fetchConh,
  fetchBedBugReports,
  fetchLitigation,
  type HpdRegistration,
  type HpdContact,
  type AepRecord,
  type VacateOrderRecord,
  type ConhRecord,
  type BedBugReport,
  type LitigationRecord,
} from '@/utils/hpdProgramsDirect';

interface UseHpdProgramsResult {
  loading: boolean;
  registration: HpdRegistration | null;
  contacts: HpdContact[];
  aep: AepRecord[];
  vacateOrders: VacateOrderRecord[];
  conh: ConhRecord | null;
  bedBugReports: BedBugReport[];
  litigation: LitigationRecord[];
  error: string | null;
}

/**
 * Fetches HPD program data directly from NYC Open Data for a given BBL.
 * Returns registration, contacts, AEP, Vacate Orders, CONH, Bed Bug Reports, and Litigation.
 * Each dataset is queried independently — a failure in one doesn't block the others.
 */
export function useHpdPrograms(bbl: string | null | undefined): UseHpdProgramsResult {
  const [loading, setLoading] = useState(false);
  const [registration, setRegistration] = useState<HpdRegistration | null>(null);
  const [contacts, setContacts] = useState<HpdContact[]>([]);
  const [aep, setAep] = useState<AepRecord[]>([]);
  const [vacateOrders, setVacateOrders] = useState<VacateOrderRecord[]>([]);
  const [conh, setConh] = useState<ConhRecord | null>(null);
  const [bedBugReports, setBedBugReports] = useState<BedBugReport[]>([]);
  const [litigation, setLitigation] = useState<LitigationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bbl || bbl.length !== 10) {
      setRegistration(null);
      setContacts([]);
      setAep([]);
      setVacateOrders([]);
      setConh(null);
      setBedBugReports([]);
      setLitigation([]);
      return;
    }

    const ctrl = new AbortController();
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      // Fetch everything in parallel. Registration also gates contacts.
      const [regRes, aepRes, vacRes, conhRes, bbRes, litRes] = await Promise.allSettled([
        fetchHpdRegistration(bbl, ctrl.signal),
        fetchAep(bbl, ctrl.signal),
        fetchVacateOrders(bbl, ctrl.signal),
        fetchConh(bbl, ctrl.signal),
        fetchBedBugReports(bbl, ctrl.signal),
        fetchLitigation(bbl, ctrl.signal),
      ]);

      if (cancelled) return;

      const reg = regRes.status === 'fulfilled' ? regRes.value : null;
      setRegistration(reg);
      setAep(aepRes.status === 'fulfilled' ? aepRes.value : []);
      setVacateOrders(vacRes.status === 'fulfilled' ? vacRes.value : []);
      setConh(conhRes.status === 'fulfilled' ? conhRes.value : null);
      setBedBugReports(bbRes.status === 'fulfilled' ? bbRes.value : []);
      setLitigation(litRes.status === 'fulfilled' ? litRes.value : []);

      // Only fetch contacts after we know the registration ID
      if (reg?.registrationId) {
        try {
          const c = await fetchHpdContacts(reg.registrationId, ctrl.signal);
          if (!cancelled) setContacts(c);
        } catch (err) {
          if ((err as Error).name !== 'AbortError' && !cancelled) {
            console.warn('Contacts fetch failed:', err);
          }
        }
      } else {
        setContacts([]);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [bbl]);

  return {
    loading,
    registration,
    contacts,
    aep,
    vacateOrders,
    conh,
    bedBugReports,
    litigation,
    error,
  };
}
