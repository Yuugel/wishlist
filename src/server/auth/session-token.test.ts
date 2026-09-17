import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
  isSessionUsable,
  verifySessionTokenDigest,
} from "./session-token";

describe("session token", () => {
  it("generates distinct 256-bit opaque tokens", () => {
    const tokens = new Set(Array.from({ length: 64 }, generateSessionToken));

    assert.equal(tokens.size, 64);
    for (const token of tokens) {
      assert.match(token, /^ws1_[A-Za-z0-9_-]{43}$/);
      assert.equal(isSessionToken(token), true);
    }
  });

  it("persists and verifies only a fixed-length digest", () => {
    const token = generateSessionToken();
    const digest = hashSessionToken(token);

    assert.equal(digest.byteLength, 32);
    assert.equal(digest.includes(Buffer.from(token, "ascii")), false);
    assert.equal(verifySessionTokenDigest(token, digest), true);
    assert.equal(verifySessionTokenDigest(generateSessionToken(), digest), false);
    assert.equal(verifySessionTokenDigest("not-a-session-token", digest), false);
  });

  it("rejects revoked, idle-expired, and absolutely expired sessions", () => {
    const now = new Date("2026-09-17T04:00:00.000Z");
    const future = new Date(now.getTime() + 1_000);
    const past = new Date(now.getTime() - 1_000);

    assert.equal(
      isSessionUsable(
        { revokedAt: null, idleExpiresAt: future, absoluteExpiresAt: future },
        now,
      ),
      true,
    );
    assert.equal(
      isSessionUsable(
        { revokedAt: now, idleExpiresAt: future, absoluteExpiresAt: future },
        now,
      ),
      false,
    );
    assert.equal(
      isSessionUsable(
        { revokedAt: null, idleExpiresAt: past, absoluteExpiresAt: future },
        now,
      ),
      false,
    );
    assert.equal(
      isSessionUsable(
        { revokedAt: null, idleExpiresAt: future, absoluteExpiresAt: past },
        now,
      ),
      false,
    );
  });
});
