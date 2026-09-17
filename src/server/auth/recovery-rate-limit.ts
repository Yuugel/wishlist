import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { AuthError } from "./auth-error";
import { parseRecoveryCode } from "./recovery-code";

const WINDOW_MS = 5 * 60 * 1_000;
const MAX_BUCKETS = 10_000;
const LIMITS = { global: 100, ip: 10, selector: 5 } as const;

type Scope = keyof typeof LIMITS;
type Bucket = { count: number; resetsAt: number };
type RateLimitGlobals = typeof globalThis & {
  wishlistRecoveryRateLimitBuckets?: Map<string, Bucket>;
};

const globals = globalThis as RateLimitGlobals;
const buckets =
  globals.wishlistRecoveryRateLimitBuckets ?? new Map<string, Bucket>();
if (process.env.NODE_ENV !== "production") {
  globals.wishlistRecoveryRateLimitBuckets = buckets;
}

function digestKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function clientKey(request: NextRequest): string {
  // Hosting must sanitize these proxy headers. Unknown clients deliberately
  // share a bucket rather than bypassing the IP dimension.
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim();
  return digestKey(forwarded || request.headers.get("x-real-ip") || "unknown");
}

function selectorKey(candidate: string): string {
  const selector = parseRecoveryCode(candidate)?.selector ?? "invalid";
  return digestKey(selector);
}

function take(scope: Scope, key: string, now: number): boolean {
  const bucketKey = `${scope}:${key}`;
  const current = buckets.get(bucketKey);
  if (!current || current.resetsAt <= now) {
    buckets.set(bucketKey, { count: 1, resetsAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= LIMITS[scope];
}

function prune(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetsAt <= now) buckets.delete(key);
  }
  if (buckets.size >= MAX_BUCKETS) {
    const oldest = [...buckets.entries()]
      .sort((left, right) => left[1].resetsAt - right[1].resetsAt)
      .slice(0, Math.ceil(MAX_BUCKETS / 10));
    for (const [key] of oldest) buckets.delete(key);
  }
}

/**
 * Bounded per-process protection with explicit global, proxy-IP, and selector
 * dimensions. A distributed deployment can replace this call at its edge while
 * retaining the same dimensions; no account lookup is involved.
 */
export function enforceRecoveryClaimRateLimit(
  request: NextRequest,
  candidate: string,
  now = Date.now(),
): void {
  prune(now);
  const allowed = [
    take("global", "all", now),
    take("ip", clientKey(request), now),
    take("selector", selectorKey(candidate), now),
  ].every(Boolean);

  if (!allowed) {
    throw new AuthError(
      "recovery_unavailable",
      429,
      "Die Wiederherstellung konnte nicht gestartet werden. Bitte versuche es später erneut.",
    );
  }
}

export function resetRecoveryRateLimitsForTests(): void {
  buckets.clear();
}
