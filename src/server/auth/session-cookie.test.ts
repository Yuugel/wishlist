import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextResponse } from "next/server";
import {
  clearedSessionCookie,
  issuedSessionCookie,
  SESSION_COOKIE_NAME,
  type SessionCookie,
} from "./session-cookie";

function serialize(cookie: SessionCookie): string {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookie);
  const header = response.headers.get("set-cookie");
  assert.ok(header);
  return header;
}

describe("session cookie policy", () => {
  it("serializes an issued host-only hardened cookie through NextResponse", () => {
    const expires = new Date("2026-10-17T04:00:00.000Z");
    const cookie = issuedSessionCookie("secret-token", expires);

    assert.equal(SESSION_COOKIE_NAME, "__Host-wishlist-session");
    assert.deepEqual(cookie, {
      name: SESSION_COOKIE_NAME,
      value: "secret-token",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires,
    });

    const serialized = serialize(cookie);
    assert.match(serialized, /^__Host-wishlist-session=secret-token;/);
    assert.match(serialized, /(?:^|; )Path=\/(?:;|$)/);
    assert.match(
      serialized,
      /(?:^|; )Expires=Sat, 17 Oct 2026 04:00:00 GMT(?:;|$)/,
    );
    assert.match(serialized, /(?:^|; )Secure(?:;|$)/);
    assert.match(serialized, /(?:^|; )HttpOnly(?:;|$)/);
    assert.match(serialized, /(?:^|; )SameSite=lax(?:;|$)/);
    assert.doesNotMatch(serialized, /(?:^|; )Domain=/i);
  });

  it("serializes logout clearing with the same hardened scope", () => {
    const cookie = clearedSessionCookie();
    const serialized = serialize(cookie);

    assert.equal(cookie.name, SESSION_COOKIE_NAME);
    assert.equal(cookie.value, "");
    assert.match(serialized, /^__Host-wishlist-session=;/);
    assert.match(serialized, /(?:^|; )Path=\/(?:;|$)/);
    assert.match(serialized, /(?:^|; )Max-Age=0(?:;|$)/);
    assert.match(serialized, /(?:^|; )Secure(?:;|$)/);
    assert.match(serialized, /(?:^|; )HttpOnly(?:;|$)/);
    assert.match(serialized, /(?:^|; )SameSite=lax(?:;|$)/);
    assert.doesNotMatch(serialized, /(?:^|; )Domain=/i);
  });
});
