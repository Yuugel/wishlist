import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextResponse } from "next/server";
import {
  clearedRecoveryCookie,
  issuedRecoveryCookie,
  RECOVERY_COOKIE_NAME,
  type RecoveryCookie,
} from "./recovery-cookie";

function serialize(cookie: RecoveryCookie): string {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookie);
  const header = response.headers.get("set-cookie");
  assert.ok(header);
  return header;
}

describe("recovery cookie policy", () => {
  it("serializes a host-only claim cookie through NextResponse", () => {
    const expires = new Date("2026-09-17T08:05:00.000Z");
    const cookie = issuedRecoveryCookie("opaque-claim", expires);

    assert.equal(RECOVERY_COOKIE_NAME, "__Host-wishlist-recovery");
    assert.deepEqual(cookie, {
      name: RECOVERY_COOKIE_NAME,
      value: "opaque-claim",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      expires,
    });

    const serialized = serialize(cookie);
    assert.match(serialized, /^__Host-wishlist-recovery=opaque-claim;/);
    assert.match(serialized, /(?:^|; )Path=\/(?:;|$)/);
    assert.match(
      serialized,
      /(?:^|; )Expires=Thu, 17 Sep 2026 08:05:00 GMT(?:;|$)/,
    );
    assert.match(serialized, /(?:^|; )Secure(?:;|$)/);
    assert.match(serialized, /(?:^|; )HttpOnly(?:;|$)/);
    assert.match(serialized, /(?:^|; )SameSite=strict(?:;|$)/);
    assert.doesNotMatch(serialized, /(?:^|; )Domain=/i);
  });

  it("serializes claim clearing with the same hardened scope", () => {
    const serialized = serialize(clearedRecoveryCookie());

    assert.match(serialized, /^__Host-wishlist-recovery=;/);
    assert.match(serialized, /(?:^|; )Path=\/(?:;|$)/);
    assert.match(serialized, /(?:^|; )Max-Age=0(?:;|$)/);
    assert.match(serialized, /(?:^|; )Secure(?:;|$)/);
    assert.match(serialized, /(?:^|; )HttpOnly(?:;|$)/);
    assert.match(serialized, /(?:^|; )SameSite=strict(?:;|$)/);
    assert.doesNotMatch(serialized, /(?:^|; )Domain=/i);
  });
});
