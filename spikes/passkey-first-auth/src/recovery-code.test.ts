import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  issueRecoveryCode,
  RecoveryCodeStore,
  verifyRecoveryCode,
} from "./recovery-code.js";

describe("recovery code", () => {
  it("persists only a selector and keyed digest and verifies the displayed code", () => {
    const pepper = randomBytes(32);
    const issued = issueRecoveryCode({ pepper, keyVersion: 1 });
    const persistedJson = JSON.stringify(issued.persisted);

    assert.match(issued.displayCode, /^wl1_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(persistedJson.includes(issued.displayCode), false);
    assert.equal("displayCode" in issued.persisted, false);
    assert.equal(issued.persisted.digest.byteLength, 32);
    assert.equal(
      verifyRecoveryCode({
        candidate: issued.displayCode,
        persisted: issued.persisted,
        pepper,
      }),
      true,
    );
  });

  it("rejects a wrong secret and a wrong pepper", () => {
    const pepper = randomBytes(32);
    const issued = issueRecoveryCode({ pepper, keyVersion: 1 });
    const [prefix, secret] = issued.displayCode.split(".");
    const wrongFirstCharacter = secret[0] === "A" ? "B" : "A";
    const wrongCode = `${prefix}.${wrongFirstCharacter}${secret.slice(1)}`;

    assert.equal(
      verifyRecoveryCode({
        candidate: wrongCode,
        persisted: issued.persisted,
        pepper,
      }),
      false,
    );
    assert.equal(
      verifyRecoveryCode({
        candidate: issued.displayCode,
        persisted: issued.persisted,
        pepper: randomBytes(32),
      }),
      false,
    );
  });

  it("permits exactly one consume transition", () => {
    const pepper = randomBytes(32);
    const issued = issueRecoveryCode({ pepper, keyVersion: 7 });
    const store = new RecoveryCodeStore(issued.persisted);

    assert.equal(store.consume(issued.displayCode, pepper), true);
    assert.equal(store.consume(issued.displayCode, pepper), false);
    assert.ok(store.snapshot().consumedAt instanceof Date);
  });

  it("refuses an undersized server pepper", () => {
    assert.throws(
      () => issueRecoveryCode({ pepper: randomBytes(31), keyVersion: 1 }),
      /at least 256 bits/,
    );
  });
});
