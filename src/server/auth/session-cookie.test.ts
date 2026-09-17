import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearedSessionCookie,
  issuedSessionCookie,
  SESSION_COOKIE_NAME,
} from "./session-cookie";

describe("session cookie policy", () => {
  it("issues a host-only hardened cookie", () => {
    const expires = new Date("2026-10-17T04:00:00.000Z");
    const cookie = issuedSessionCookie("secret-token", expires);

    assert.equal(SESSION_COOKIE_NAME, "__Host-wishlist-session");
    assert.deepEqual(cookie.options, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires,
    });
    assert.equal("domain" in cookie.options, false);
  });

  it("clears the same cookie scope on logout", () => {
    const cookie = clearedSessionCookie();

    assert.equal(cookie.name, SESSION_COOKIE_NAME);
    assert.equal(cookie.value, "");
    assert.equal(cookie.options.maxAge, 0);
    assert.equal(cookie.options.path, "/");
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.secure, true);
  });
});
