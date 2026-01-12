// Simple in-memory cache for edge functions
// Caches responses to avoid repeated upstream calls

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// In-memory cache store (resets on cold starts)
const cache = new Map<string, CacheEntry<unknown>>();

// Maximum cache size to prevent memory issues
const MAX_CACHE_SIZE = 500;

// Clean expired entries periodically
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 30000; // 30 seconds

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  
  lastCleanup = now;
  
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt < now) {
      cache.delete(key);
    }
  }
  
  // If still too large, remove oldest entries
  if (cache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toRemove = entries.slice(0, cache.size - MAX_CACHE_SIZE);
    for (const [key] of toRemove) {
      cache.delete(key);
    }
  }
}

// TTL presets in milliseconds
export const CACHE_TTL = {
  GEOCLIENT: 24 * 60 * 60 * 1000, // 24 hours for address lookups
  OPEN_DATA: 10 * 60 * 1000, // 10 minutes for NYC Open Data
  SHORT: 5 * 60 * 1000, // 5 minutes
} as const;

// Generate a cache key from endpoint and params
export function generateCacheKey(endpoint: string, params: Record<string, string>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return `${endpoint}:${sortedParams}`;
}

// Get cached data
export function getCached<T>(key: string): T | null {
  cleanup();
  
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  
  return entry.data;
}

// Set cached data
export function setCache<T>(key: string, data: T, ttlMs: number): void {
  cleanup();
  
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

// Check if cache has valid entry
export function hasValidCache(key: string): boolean {
  const entry = cache.get(key);
  return entry !== undefined && entry.expiresAt > Date.now();
}
