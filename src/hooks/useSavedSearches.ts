import { useState, useEffect, useCallback } from 'react';

export interface SavedSearch {
  id: string;
  label: string;
  bbl: string;
  address?: string;
  borough?: string;
  bin?: string;
  createdAt: string;
  lastOpenedAt: string;
}

const STORAGE_KEY = 'nyc-building-intel-saved-searches';
const MAX_SAVED_SEARCHES = 50;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function loadFromStorage(): SavedSearch[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      console.warn('[SavedSearches] Corrupted data, resetting');
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    
    // Validate each item
    return parsed.filter((item): item is SavedSearch => 
      item &&
      typeof item.id === 'string' &&
      typeof item.label === 'string' &&
      typeof item.bbl === 'string' &&
      typeof item.createdAt === 'string' &&
      typeof item.lastOpenedAt === 'string'
    );
  } catch (error) {
    console.warn('[SavedSearches] Error loading, resetting:', error);
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function saveToStorage(searches: SavedSearch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch (error) {
    console.error('[SavedSearches] Error saving:', error);
  }
}

export function useSavedSearches() {
  const [searches, setSearches] = useState<SavedSearch[]>(() => loadFromStorage());

  // Sync to localStorage whenever searches change
  useEffect(() => {
    saveToStorage(searches);
  }, [searches]);

  const saveSearch = useCallback((params: {
    bbl: string;
    address?: string;
    borough?: string;
    bin?: string;
    label?: string;
  }): SavedSearch => {
    const now = new Date().toISOString();
    const newSearch: SavedSearch = {
      id: generateId(),
      label: params.label || params.address || `BBL ${params.bbl}`,
      bbl: params.bbl,
      address: params.address,
      borough: params.borough,
      bin: params.bin,
      createdAt: now,
      lastOpenedAt: now,
    };

    setSearches(prev => {
      // Check if BBL already exists
      const existingIndex = prev.findIndex(s => s.bbl === params.bbl);
      let updated: SavedSearch[];
      
      if (existingIndex >= 0) {
        // Update existing
        updated = [...prev];
        updated[existingIndex] = {
          ...updated[existingIndex],
          lastOpenedAt: now,
          address: params.address || updated[existingIndex].address,
          borough: params.borough || updated[existingIndex].borough,
          bin: params.bin || updated[existingIndex].bin,
        };
      } else {
        // Add new (FIFO eviction if over limit)
        updated = [newSearch, ...prev];
        if (updated.length > MAX_SAVED_SEARCHES) {
          updated = updated.slice(0, MAX_SAVED_SEARCHES);
        }
      }
      
      return updated;
    });

    return newSearch;
  }, []);

  const updateLastOpened = useCallback((id: string) => {
    setSearches(prev => 
      prev.map(s => 
        s.id === id 
          ? { ...s, lastOpenedAt: new Date().toISOString() }
          : s
      )
    );
  }, []);

  const renameSearch = useCallback((id: string, newLabel: string) => {
    setSearches(prev => 
      prev.map(s => 
        s.id === id 
          ? { ...s, label: newLabel }
          : s
      )
    );
  }, []);

  const deleteSearch = useCallback((id: string) => {
    setSearches(prev => prev.filter(s => s.id !== id));
  }, []);

  const isSearchSaved = useCallback((bbl: string): boolean => {
    return searches.some(s => s.bbl === bbl);
  }, [searches]);

  const getSearchByBBL = useCallback((bbl: string): SavedSearch | undefined => {
    return searches.find(s => s.bbl === bbl);
  }, [searches]);

  const buildResultsUrl = useCallback((search: SavedSearch, tab?: string): string => {
    const params = new URLSearchParams();
    params.set('bbl', search.bbl);
    if (search.address) params.set('address', search.address);
    if (search.borough) params.set('borough', search.borough);
    if (search.bin) params.set('bin', search.bin);
    if (tab) params.set('tab', tab);
    return `/results?${params.toString()}`;
  }, []);

  return {
    searches,
    saveSearch,
    updateLastOpened,
    renameSearch,
    deleteSearch,
    isSearchSaved,
    getSearchByBBL,
    buildResultsUrl,
  };
}
