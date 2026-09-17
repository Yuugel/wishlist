import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { AuthError } from "./auth-error";
import {
  enforceRecoveryClaimRateLimit,
  resetRecoveryRateLimitsForTests,
} from "./recovery-rate-limit";

const selector = "A".repeat(22);
const code = `wl1_${selector}.${"B".repeat(43)}`;

function request(ip: string) {
  return new NextRequest("https://wishlist.example/api/auth/recovery/options", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("recovery claim rate limits", () => {
  it("bounds selector attempts without account lookup", () => {
    resetRecoveryRateLimitsForTests();
    const at = Date.parse("2026-09-17T08:00:00.000Z");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      enforceRecoveryClaimRateLimit(request(`192.0.2.${attempt}`), code, at);
    }

    assert.throws(
      () => enforceRecoveryClaimRateLimit(request("192.0.2.99"), code, at),
      (error: unknown) =>
        error instanceof AuthError && error.code === "recovery_unavailable",
    );
  });

  it("resets fixed windows and never retains the secret as a key", () => {
    resetRecoveryRateLimitsForTests();
    const at = Date.parse("2026-09-17T08:00:00.000Z");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      enforceRecoveryClaimRateLimit(request("198.51.100.1"), code, at);
    }
    assert.doesNotThrow(() =>
      enforceRecoveryClaimRateLimit(
        request("198.51.100.1"),
        code,
        at + 5 * 60 * 1_000,
      ),
    );
  });
});
