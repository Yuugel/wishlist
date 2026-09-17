import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  canAddCredential,
  storedChallengeMatcher,
} from "./passkey-policy";
import { hashWebAuthnChallenge } from "./webauthn-ceremony";

describe("passkey policy", () => {
  it("requires discoverable registration and user verification", async () => {
    const options = await buildRegistrationOptions({
      rpID: "localhost",
      rpName: "Wishlist",
      userHandle: randomBytes(32),
      displayName: "Testperson",
      existingCredentials: [{ id: "AQID" }],
    });

    assert.equal(options.authenticatorSelection?.residentKey, "required");
    assert.equal(options.authenticatorSelection?.userVerification, "required");
    assert.equal(options.attestation, "none");
    assert.deepEqual(options.excludeCredentials?.map((item) => item.id), ["AQID"]);
    assert.equal(options.user.name.includes("@"), false);
  });

  it("creates username-less authentication options", async () => {
    const options = await buildAuthenticationOptions({ rpID: "localhost" });

    assert.equal(options.rpId, "localhost");
    assert.equal(options.userVerification, "required");
    assert.equal(options.allowCredentials?.length ?? 0, 0);
    assert.equal(JSON.stringify(options).includes("allowCredentials"), false);
  });

  it("matches only the challenge represented by the persisted digest", () => {
    const challenge = "library-generated-challenge-value";
    const matches = storedChallengeMatcher(hashWebAuthnChallenge(challenge));

    assert.equal(matches(challenge), true);
    assert.equal(matches("different-library-challenge"), false);
    assert.equal(matches("short"), false);
  });

  it("binds additional credentials to the same account and a fresh session", () => {
    const now = new Date("2026-09-17T04:00:00.000Z");
    const fresh = new Date(now.getTime() - 60_000);
    const stale = new Date(now.getTime() - 11 * 60_000);

    assert.equal(
      canAddCredential({
        sessionUserId: "user-a",
        ceremonyUserId: "user-a",
        sessionCreatedAt: fresh,
        now,
      }),
      true,
    );
    assert.equal(
      canAddCredential({
        sessionUserId: "user-a",
        ceremonyUserId: "user-b",
        sessionCreatedAt: fresh,
        now,
      }),
      false,
    );
    assert.equal(
      canAddCredential({
        sessionUserId: "user-a",
        ceremonyUserId: "user-a",
        sessionCreatedAt: stale,
        now,
      }),
      false,
    );
  });
});
