/**
 * Rate limiter berbasis in-memory.
 *
 * ⚠️  DEVELOPMENT / SINGLE-INSTANCE ONLY
 *
 * Implementasi ini memakai Map yang hidup di memori proses. Di lingkungan
 * serverless (Vercel, AWS Lambda, dll.) setiap cold start memulai Map baru
 * dan instance berbeda tidak berbagi state, sehingga rate limiter ini
 * TIDAK EFEKTIF di production serverless.
 *
 * Untuk production deployment, ganti dengan penyimpanan terdistribusi:
 *   - Upstash Redis  : https://upstash.com  (ada free tier, serverless-native)
 *   - Vercel KV      : https://vercel.com/storage/kv
 *   - Cloudflare WAF : rate limiting di layer CDN tanpa kode tambahan
 *
 * Selama belum diganti, rate limiter ini masih berguna di development lokal
 * dan deployment single-instance (PM2, Docker tunggal, VPS).
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export type RateLimitResult = {
  limited: boolean;
  remaining: number;
  retryAfter: number;
};

export function rateLimit(key: string): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { limited: false, remaining: MAX_REQUESTS - 1, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > MAX_REQUESTS) {
    return {
      limited: true,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { limited: false, remaining: MAX_REQUESTS - existing.count, retryAfter: 0 };
}
