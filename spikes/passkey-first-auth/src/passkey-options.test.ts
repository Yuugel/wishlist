import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Base64URLString } from "@simplewebauthn/server";
import {
  authenticationOptions,
  registrationOptions,
} from "./passkey-options.js";

const accountHandle = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

describe("passkey-first option generation", () => {
  it("creates discoverable, user-verified registration without email/password", async () => {
    const options = await registrationOptions({
      accountHandle,
      displayName: "Wishlist fan",
      existingCredentials: [],
    });

    assert.equal(options.rp.id, "localhost");
    assert.equal(options.user.displayName, "Wishlist fan");
    assert.equal(options.authenticatorSelection?.residentKey, "required");
    assert.equal(options.authenticatorSelection?.requireResidentKey, true);
    assert.equal(options.authenticatorSelection?.userVerification, "required");
    assert.equal(options.attestation, "none");
    assert.equal(Object.hasOwn(options.user, "email"), false);
    assert.equal(Object.hasOwn(options.user, "password"), false);
    assert.ok(options.challenge.length >= 32);
  });

  it("allows another credential for the account while excluding existing IDs", async () => {
    const existingId = Buffer.alloc(32, 7).toString("base64url") as Base64URLString;
    const options = await registrationOptions({
      accountHandle,
      displayName: "Wishlist fan",
      existingCredentials: [{ id: existingId, transports: ["internal"] }],
    });

    assert.equal(options.excludeCredentials?.length, 1);
    assert.equal(options.excludeCredentials?.[0]?.id, existingId);
    assert.deepEqual(options.excludeCredentials?.[0]?.transports, ["internal"]);
  });

  it("creates username-less login options after logout", async () => {
    const options = await authenticationOptions();

    assert.equal(options.rpId, "localhost");
    assert.equal(options.userVerification, "required");
    assert.equal(options.allowCredentials, undefined);
    assert.ok(options.challenge.length >= 32);
  });
});
