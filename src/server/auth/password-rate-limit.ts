import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { AuthError } from "./auth-error";

const WINDOW_MS = 5 * 60 * 1_000;
const MAX_BUCKETS = 10_000;
const LIMITS = {
  login: { global: 200, ip: 30, identity: 10 },
  signup: { global: 100, ip: 10, identity: 5 },
  set: { global: 100, ip: 15, identity: 5 },
} as const;

type Action = keyof typeof LIMITS;
type Dimension = keyof (typeof LIMITS)[Action];
type Bucket = { count: number; resetsAt: number };
type RateLimitGlobals = typeof globalThis & {
  wishlistPasswordRateLimitBuckets?: Map<string, Bucket>;
};

const globals = globalThis as RateLimitGlobals;
const buckets =
  globals.wishlistPasswordRateLimitBuckets ?? new Map<string, Bucket>();
if (process.env.NODE_ENV !== "production") {
  globals.wishlistPasswordRateLimitBuckets = buckets;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function clientKey(request: NextRequest): string {
  // The hosting edge must sanitize proxy headers, as for recovery rate limits.
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim();
  return digest(forwarded || request.headers.get("x-real-ip") || "unknown");
}

function take(
  action: Action,
  dimension: Dimension,
  key: string,
  now: number,
): boolean {
  const bucketKey = `${action}:${dimension}:${key}`;
  const current = buckets.get(bucketKey);
  if (!current || current.resetsAt <= now) {
    buckets.set(bucketKey, { count: 1, resetsAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= LIMITS[action][dimension];
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

/** Per-process defense; production edge limits should preserve these dimensions. */
export function enforcePasswordRateLimit(
  request: NextRequest,
  action: Action,
  identity: string,
  now = Date.now(),
): void {
  prune(now);
  const limits = [
    take(action, "global", "all", now),
    take(action, "ip", clientKey(request), now),
    take(action, "identity", digest(identity || "invalid"), now),
  ];
  if (!limits.every(Boolean)) {
    throw new AuthError(
      "password_auth_unavailable",
      429,
      "Zu viele Versuche. Bitte warte kurz und versuche es erneut.",
    );
  }
}

export function resetPasswordRateLimitsForTests(): void {
  buckets.clear();
}
