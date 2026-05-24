/**
 * Simple in-memory rate limiter.
 * Per-serverless-instance — not shared across Vercel functions.
 * For multi-instance deployments, replace with Upstash Redis.
 */

interface RateLimitEntry {
  count:     number
  resetAt:   number
}

const store = new Map<string, RateLimitEntry>()

// Prune expired entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key)
  }
}, 5 * 60 * 1000)

export function checkRateLimit(
  key:        string,
  maxRequests: number,
  windowMs:   number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now  = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs }
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt }
}
