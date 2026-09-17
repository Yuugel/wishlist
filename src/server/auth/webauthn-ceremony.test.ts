import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashWebAuthnChallenge,
  isWebAuthnCeremonyUsable,
} from "./webauthn-ceremony";

describe("WebAuthn ceremony state", () => {
  it("hashes challenge state for fixed-length persistence", () => {
    const digest = hashWebAuthnChallenge("a-secure-library-generated-challenge");

    assert.equal(digest.byteLength, 32);
    assert.equal(
      digest.equals(
        hashWebAuthnChallenge("a-different-library-generated-challenge"),
      ),
      false,
    );
  });

  it("rejects expired, consumed, and attempt-exhausted ceremonies", () => {
    const now = new Date("2026-09-17T04:00:00.000Z");
    const future = new Date(now.getTime() + 1_000);
    const past = new Date(now.getTime() - 1_000);

    assert.equal(
      isWebAuthnCeremonyUsable(
        { expiresAt: future, consumedAt: null, attemptCount: 0, maxAttempts: 5 },
        now,
      ),
      true,
    );
    assert.equal(
      isWebAuthnCeremonyUsable(
        { expiresAt: past, consumedAt: null, attemptCount: 0, maxAttempts: 5 },
        now,
      ),
      false,
    );
    assert.equal(
      isWebAuthnCeremonyUsable(
        { expiresAt: future, consumedAt: now, attemptCount: 0, maxAttempts: 5 },
        now,
      ),
      false,
    );
    assert.equal(
      isWebAuthnCeremonyUsable(
        { expiresAt: future, consumedAt: null, attemptCount: 5, maxAttempts: 5 },
        now,
      ),
      false,
    );
  });
});
