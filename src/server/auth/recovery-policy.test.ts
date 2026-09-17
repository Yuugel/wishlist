import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRecoveryCeremonyAuthorized,
  type RecoveryCeremonyContext,
} from "./recovery-policy";

const now = new Date("2026-09-17T08:00:00.000Z");

function ceremony(
  changes: Partial<RecoveryCeremonyContext> = {},
): RecoveryCeremonyContext {
  return {
    type: "recovery",
    userId: "user-a",
    recoveryUserId: "user-a",
    recoveryCodeId: "code-a",
    claimId: "claim-a",
    recoveryStatus: "claimed",
    userStatus: "active",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
    attemptCount: 0,
    maxAttempts: 5,
    ...changes,
  };
}

function authorized(value: RecoveryCeremonyContext, claimToken = "claim-a") {
  return isRecoveryCeremonyAuthorized({ ceremony: value, claimToken, now });
}

describe("recovery ceremony authorization", () => {
  it("accepts only the claimed recovery operation bound to its account", () => {
    assert.equal(authorized(ceremony()), true);
    assert.equal(authorized(ceremony(), "other-claim"), false);
    assert.equal(authorized(ceremony({ type: "add_credential" })), false);
    assert.equal(authorized(ceremony({ recoveryUserId: "user-b" })), false);
    assert.equal(authorized(ceremony({ recoveryCodeId: null })), false);
    assert.equal(authorized(ceremony({ recoveryStatus: "active" })), false);
    assert.equal(authorized(ceremony({ userStatus: "disabled" })), false);
  });

  it("rejects expired, consumed, and exhausted ceremonies", () => {
    assert.equal(authorized(ceremony({ expiresAt: now })), false);
    assert.equal(authorized(ceremony({ consumedAt: now })), false);
    assert.equal(authorized(ceremony({ attemptCount: 5 })), false);
  });
});
