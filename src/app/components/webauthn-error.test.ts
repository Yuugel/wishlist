import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { webAuthnErrorMessage } from "./webauthn-error";

describe("WebAuthn browser error messages", () => {
  it("maps NotAllowed, timeout, and cancellation errors to understandable German", () => {
    const expected =
      "Der Passkey-Vorgang wurde abgebrochen, ist abgelaufen oder auf diesem Gerät ist kein passender Passkey verfügbar.";

    assert.equal(
      webAuthnErrorMessage(Object.assign(new Error("The operation either timed out or was not allowed"), {
        name: "NotAllowedError",
      })),
      expected,
    );
    assert.equal(
      webAuthnErrorMessage(new Error("The operation either timed out or was not allowed")),
      expected,
    );
    assert.equal(
      webAuthnErrorMessage(Object.assign(new Error("cancelled"), { name: "AbortError" })),
      expected,
    );
  });

  it("retains safe German API messages", () => {
    assert.equal(
      webAuthnErrorMessage(new Error("Der Passkey konnte nicht bestätigt werden.")),
      "Der Passkey konnte nicht bestätigt werden.",
    );
  });
});
