/**
 * CSV Export Utility
 * Exports data to CSV format with proper escaping and download
 */

interface ExportOptions {
  filename: string;
  columns: { key: string; header: string }[];
  includeRawColumn?: boolean;
}

/**
 * Escape a value for CSV (handles quotes, commas, newlines)
 */
function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  
  const stringValue = typeof value === 'object' 
    ? JSON.stringify(value) 
    : String(value);
  
  // If the value contains commas, quotes, or newlines, wrap in quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

/**
 * Convert an array of objects to CSV string
 */
export function toCSV<T extends Record<string, unknown>>(
  data: T[],
  options: ExportOptions
): string {
  const { columns, includeRawColumn = true } = options;
  
  // Build headers
  const headers = columns.map(col => escapeCSV(col.header));
  if (includeRawColumn) {
    headers.push('raw_json');
  }
  
  // Build rows
  const rows = data.map(item => {
    const row = columns.map(col => escapeCSV(item[col.key]));
    if (includeRawColumn) {
      row.push(escapeCSV(JSON.stringify(item)));
    }
    return row.join(',');
  });
  
  return [headers.join(','), ...rows].join('\n');
}

/**
 * Download CSV content as a file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export data to CSV and trigger download
 */
export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  options: ExportOptions
): void {
  const csv = toCSV(data, options);
  downloadCSV(csv, options.filename);
}

// Predefined column configurations for each data type
export const VIOLATIONS_COLUMNS = [
  { key: 'issueDate', header: 'Issue Date' },
  { key: 'status', header: 'Status' },
  { key: 'category', header: 'Category' },
  { key: 'description', header: 'Description' },
  { key: 'recordId', header: 'Record ID' },
];

export const ECB_COLUMNS = [
  { key: 'issueDate', header: 'Issue Date' },
  { key: 'status', header: 'Status' },
  { key: 'severity', header: 'Severity' },
  { key: 'category', header: 'Category' },
  { key: 'description', header: 'Description' },
  { key: 'penaltyAmount', header: 'Penalty Amount' },
  { key: 'balanceDue', header: 'Balance Due' },
  { key: 'recordId', header: 'Record ID' },
];

export const PERMITS_COLUMNS = [
  { key: 'issueDate', header: 'Issue Date' },
  { key: 'status', header: 'Status' },
  { key: 'permitType', header: 'Permit Type' },
  { key: 'workType', header: 'Work Type' },
  { key: 'description', header: 'Description' },
  { key: 'expirationDate', header: 'Expiration Date' },
  { key: 'jobNumber', header: 'Job Number' },
  { key: 'applicantName', header: 'Applicant' },
  { key: 'ownerName', header: 'Owner' },
];

export const SAFETY_COLUMNS = [
  { key: 'issueDate', header: 'Issue Date' },
  { key: 'status', header: 'Status' },
  { key: 'category', header: 'Category' },
  { key: 'description', header: 'Description' },
  { key: 'resolvedDate', header: 'Resolved Date' },
  { key: 'recordId', header: 'Record ID' },
];

export const SUMMARY_COLUMNS = [
  { key: 'recordType', header: 'Record Type' },
  { key: 'totalCount', header: 'Total Count' },
  { key: 'openCount', header: 'Open Count' },
  { key: 'lastActivityDate', header: 'Last Activity Date' },
];
