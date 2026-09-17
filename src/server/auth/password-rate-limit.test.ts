import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { AuthError } from "./auth-error";
import {
  enforcePasswordRateLimit,
  resetPasswordRateLimitsForTests,
} from "./password-rate-limit";

function request(ip: string) {
  return new NextRequest("http://localhost:3000/api/auth/password/login", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

afterEach(resetPasswordRateLimitsForTests);

describe("password authentication rate limit", () => {
  it("bounds attempts by privacy-preserving normalized identity", () => {
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.doesNotThrow(() =>
        enforcePasswordRateLimit(
          request(`192.0.2.${attempt}`),
          "login",
          "ada@example.com",
          now,
        ),
      );
    }
    assert.throws(
      () => enforcePasswordRateLimit(
        request("192.0.2.200"),
        "login",
        "ada@example.com",
        now,
      ),
      (error: unknown) => error instanceof AuthError && error.status === 429,
    );
  });

  it("opens a fresh window after expiry", () => {
    const requestValue = request("192.0.2.1");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      enforcePasswordRateLimit(requestValue, "login", "ada@example.com", 0);
    }
    assert.doesNotThrow(() =>
      enforcePasswordRateLimit(
        requestValue,
        "login",
        "ada@example.com",
        5 * 60 * 1_000,
      ),
    );
  });
});
