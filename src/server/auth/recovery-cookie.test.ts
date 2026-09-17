import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearedRecoveryCookie,
  issuedRecoveryCookie,
  RECOVERY_COOKIE_NAME,
} from "./recovery-cookie";

describe("recovery cookie policy", () => {
  it("keeps the claim out of JavaScript and restricts cross-site requests", () => {
    const expires = new Date("2026-09-17T08:05:00.000Z");
    const cookie = issuedRecoveryCookie("opaque-claim", expires);

    assert.equal(RECOVERY_COOKIE_NAME, "__Host-wishlist-recovery");
    assert.equal(cookie.value, "opaque-claim");
    assert.deepEqual(cookie.options, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      expires,
    });
  });

  it("clears the claim after completion", () => {
    assert.equal(clearedRecoveryCookie().options.maxAge, 0);
  });
});
