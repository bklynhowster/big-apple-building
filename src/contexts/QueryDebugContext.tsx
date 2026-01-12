import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

export interface QueryLogEntry {
  id: string;
  timestamp: number;
  endpoint: string;
  requestUrl: string;
  params: Record<string, string>;
  dataset?: string;
  scope?: 'unit' | 'building';
  status: 'pending' | 'success' | 'error';
  responseTime?: number;
}

interface QueryDebugContextValue {
  logs: QueryLogEntry[];
  contextBbl: string | null;
  billingBbl: string | null;
  bin: string | null;
  isDebugMode: boolean;
  setContextInfo: (bbl: string | null, billingBbl: string | null, bin: string | null) => void;
  logQuery: (entry: Omit<QueryLogEntry, 'id' | 'timestamp'>) => string;
  updateQueryStatus: (id: string, status: 'success' | 'error', responseTime?: number) => void;
  clearLogs: () => void;
}

const QueryDebugContext = createContext<QueryDebugContextValue | null>(null);

export function QueryDebugProvider({ children }: { children: React.ReactNode }) {
  const [logs, setLogs] = useState<QueryLogEntry[]>([]);
  const [contextBbl, setContextBbl] = useState<string | null>(null);
  const [billingBbl, setBillingBbl] = useState<string | null>(null);
  const [bin, setBin] = useState<string | null>(null);

  // Check if debug mode is enabled via URL
  const isDebugMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === '1';
  }, []);

  const setContextInfo = useCallback((bbl: string | null, billing: string | null, binVal: string | null) => {
    setContextBbl(bbl);
    setBillingBbl(billing);
    setBin(binVal);
  }, []);

  const logQuery = useCallback((entry: Omit<QueryLogEntry, 'id' | 'timestamp'>): string => {
    const id = `query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const logEntry: QueryLogEntry = {
      ...entry,
      id,
      timestamp: Date.now(),
    };
    setLogs(prev => [...prev.slice(-49), logEntry]); // Keep last 50 entries
    return id;
  }, []);

  const updateQueryStatus = useCallback((id: string, status: 'success' | 'error', responseTime?: number) => {
    setLogs(prev => prev.map(log => 
      log.id === id ? { ...log, status, responseTime } : log
    ));
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const value = useMemo(() => ({
    logs,
    contextBbl,
    billingBbl,
    bin,
    isDebugMode,
    setContextInfo,
    logQuery,
    updateQueryStatus,
    clearLogs,
  }), [logs, contextBbl, billingBbl, bin, isDebugMode, setContextInfo, logQuery, updateQueryStatus, clearLogs]);

  return (
    <QueryDebugContext.Provider value={value}>
      {children}
    </QueryDebugContext.Provider>
  );
}

export function useQueryDebug() {
  const context = useContext(QueryDebugContext);
  if (!context) {
    throw new Error('useQueryDebug must be used within a QueryDebugProvider');
  }
  return context;
}

// Hook for optional debug context (won't throw if not in provider)
export function useQueryDebugOptional() {
  return useContext(QueryDebugContext);
}
