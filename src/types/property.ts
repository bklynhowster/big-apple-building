export interface PropertyAddress {
  houseNumber: string;
  streetName: string;
  borough: Borough;
}

export type Borough = 'MANHATTAN' | 'BRONX' | 'BROOKLYN' | 'QUEENS' | 'STATEN ISLAND';

export const BOROUGH_CODES: Record<Borough, string> = {
  'MANHATTAN': '1',
  'BRONX': '2',
  'BROOKLYN': '3',
  'QUEENS': '4',
  'STATEN ISLAND': '5',
};

export interface BBL {
  borough: string;
  block: string;
  lot: string;
}

export interface PropertyInfo {
  address: string;
  borough: Borough;
  block: string;
  lot: string;
  bbl: string;
  bin?: string;
}

export interface DOBViolation {
  id: string;
  violationNumber: string;
  issueDate: string;
  violationType: string;
  description: string;
  status: 'OPEN' | 'RESOLVED' | 'PENDING';
  dispositionDate?: string;
  dispositionComments?: string;
}

export interface ECBViolation {
  id: string;
  ecbNumber: string;
  issueDate: string;
  violationType: string;
  description: string;
  status: 'OPEN' | 'RESOLVED' | 'PENDING';
  severity: 'HAZARDOUS' | 'MAJOR' | 'MINOR' | 'UNKNOWN';
  penaltyAmount?: number;
  hearingDate?: string;
}

export interface SafetyViolation {
  id: string;
  violationNumber: string;
  issueDate: string;
  violationType: string;
  description: string;
  status: 'OPEN' | 'RESOLVED' | 'PENDING';
  class: 'A' | 'B' | 'C' | 'I';
}

export interface Permit {
  id: string;
  jobNumber: string;
  permitType: string;
  filingDate: string;
  issueDate?: string;
  expirationDate?: string;
  status: 'ISSUED' | 'PENDING' | 'EXPIRED' | 'COMPLETED';
  workType: string;
  description: string;
}

export interface PropertyData {
  info: PropertyInfo;
  violations: DOBViolation[];
  ecbViolations: ECBViolation[];
  safetyViolations: SafetyViolation[];
  permits: Permit[];
}

export interface SearchFilters {
  status: 'all' | 'open' | 'resolved';
  dateFrom?: string;
  dateTo?: string;
  keyword: string;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}
