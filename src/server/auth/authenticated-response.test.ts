import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authenticatedJsonResponse } from "./authenticated-response";

describe("authenticated response", () => {
  it("uses the hardened existing session cookie for password and passkey callers", () => {
    const response = authenticatedJsonResponse({
      token: "opaque-session-token",
      sessionId: "session-id",
      idleExpiresAt: new Date("2026-09-24T12:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-10-17T12:00:00.000Z"),
    });
    const cookie = response.headers.get("set-cookie") ?? "";

    assert.match(cookie, /^__Host-wishlist-session=opaque-session-token;/);
    assert.match(cookie, /(?:^|; )Path=\/(?:;|$)/);
    assert.match(cookie, /(?:^|; )Secure(?:;|$)/);
    assert.match(cookie, /(?:^|; )HttpOnly(?:;|$)/);
    assert.match(cookie, /(?:^|; )SameSite=lax(?:;|$)/);
    assert.doesNotMatch(cookie, /Domain=/i);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});
