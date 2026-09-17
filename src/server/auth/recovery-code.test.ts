import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  calculateRecoveryCodeDigest,
  generateRecoveryCode,
  parseRecoveryCode,
  verifyRecoveryCode,
} from "./recovery-code";

describe("recovery code", () => {
  it("generates a 128-bit selector and independent 256-bit secret", () => {
    const pepper = randomBytes(32);
    const issued = generateRecoveryCode({ pepper, pepperKeyVersion: 3 });
    const parsed = parseRecoveryCode(issued.displayCode);

    assert.match(
      issued.displayCode,
      /^wl1_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/,
    );
    assert.ok(parsed);
    assert.equal(Buffer.from(parsed.selector, "base64url").byteLength, 16);
    assert.equal(Buffer.from(parsed.secret, "base64url").byteLength, 32);
    assert.equal(issued.selector, parsed.selector);
    assert.equal(issued.digest.byteLength, 32);
    assert.equal(issued.pepperKeyVersion, 3);
  });

  it("uses the documented domain-separated HMAC digest", () => {
    const pepper = Buffer.alloc(32, 7);
    const selector = Buffer.alloc(16, 1).toString("base64url");
    const secret = Buffer.alloc(32, 2).toString("base64url");
    const expected = createHmac("sha256", pepper)
      .update("wishlist-recovery\0", "utf8")
      .update(selector, "ascii")
      .update("\0", "ascii")
      .update(secret, "ascii")
      .digest();

    assert.deepEqual(
      calculateRecoveryCodeDigest({ selector, secret, pepper }),
      expected,
    );
  });

  it("accepts the issued code and rejects wrong code material", () => {
    const pepper = randomBytes(32);
    const issued = generateRecoveryCode({ pepper, pepperKeyVersion: 1 });
    const parsed = parseRecoveryCode(issued.displayCode);
    assert.ok(parsed);

    assert.equal(
      verifyRecoveryCode({
        candidate: issued.displayCode,
        selector: issued.selector,
        persistedDigest: issued.digest,
        pepper,
      }),
      true,
    );

    const wrongFirst = parsed.secret[0] === "A" ? "B" : "A";
    const wrongCode = `wl1_${parsed.selector}.${wrongFirst}${parsed.secret.slice(1)}`;
    assert.equal(
      verifyRecoveryCode({
        candidate: wrongCode,
        selector: issued.selector,
        persistedDigest: issued.digest,
        pepper,
      }),
      false,
    );
    assert.equal(
      verifyRecoveryCode({
        candidate: issued.displayCode,
        selector: issued.selector,
        persistedDigest: issued.digest,
        pepper: randomBytes(32),
      }),
      false,
    );
  });

  it("rejects malformed codes and undersized peppers", () => {
    assert.equal(parseRecoveryCode("wl1_short.short"), null);
    assert.equal(parseRecoveryCode("wl2_A.B"), null);
    assert.throws(
      () =>
        generateRecoveryCode({
          pepper: randomBytes(31),
          pepperKeyVersion: 1,
        }),
      /at least 256 bits/,
    );
  });
});
