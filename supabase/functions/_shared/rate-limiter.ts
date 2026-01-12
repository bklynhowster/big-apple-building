// Simple in-memory rate limiter for edge functions
// Uses IP-based tracking with sliding window

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// In-memory store (will reset on cold starts, which is acceptable)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean old entries periodically
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60000; // 1 minute

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  
  lastCleanup = now;
  const cutoff = now - 60000; // 1 minute window
  
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.windowStart < cutoff) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
}

export function checkRateLimit(
  ip: string,
  maxRequests: number = 30,
  windowMs: number = 60000
): RateLimitResult {
  cleanup();
  
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  
  if (!entry || now - entry.windowStart >= windowMs) {
    // New window
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  
  if (entry.count >= maxRequests) {
    // Rate limited
    const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  
  // Increment count
  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count };
}

// Extract IP from request headers
export function getClientIP(req: Request): string {
  // Check common proxy headers
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIP = req.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }
  
  // Fallback - use a hash of user agent + some headers for uniqueness
  const ua = req.headers.get('user-agent') || 'unknown';
  return `unknown-${ua.substring(0, 20)}`;
}
