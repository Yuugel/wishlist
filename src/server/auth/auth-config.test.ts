import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWebAuthnConfig } from "./auth-config";

describe("WebAuthn deployment configuration", () => {
  it("keeps localhost defaults limited to development", () => {
    assert.deepEqual(resolveWebAuthnConfig({ NODE_ENV: "development" }), {
      rpID: "localhost",
      rpName: "Wishlist",
      origin: "http://localhost:3000",
    });

    assert.throws(
      () => resolveWebAuthnConfig({ NODE_ENV: "production" }),
      /required in production/,
    );
    assert.throws(
      () =>
        resolveWebAuthnConfig({
          NODE_ENV: "production",
          WEBAUTHN_ORIGIN: "http://localhost:3000",
          WEBAUTHN_RP_ID: "localhost",
        }),
      /allowed only in development/,
    );
  });

  it("accepts an explicit stable production RP ID and exact HTTPS origin", () => {
    assert.deepEqual(
      resolveWebAuthnConfig({
        NODE_ENV: "production",
        WEBAUTHN_ORIGIN: "https://wishlist.example.com",
        WEBAUTHN_RP_ID: "wishlist.example.com",
        WEBAUTHN_RP_NAME: "Wishlist Production",
      }),
      {
        rpID: "wishlist.example.com",
        rpName: "Wishlist Production",
        origin: "https://wishlist.example.com",
      },
    );
  });

  it("rejects non-exact origins and RP IDs outside the origin hostname", () => {
    assert.throws(
      () =>
        resolveWebAuthnConfig({
          NODE_ENV: "production",
          WEBAUTHN_ORIGIN: "https://wishlist.example.com/path",
          WEBAUTHN_RP_ID: "wishlist.example.com",
        }),
      /exact HTTPS origin/,
    );
    assert.throws(
      () =>
        resolveWebAuthnConfig({
          NODE_ENV: "production",
          WEBAUTHN_ORIGIN: "https://wishlist.example.com",
          WEBAUTHN_RP_ID: "other.example.com",
        }),
      /valid registrable suffix/,
    );
  });

  it("disables passkeys on Vercel previews unless they are explicitly enabled", () => {
    const preview = {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      WEBAUTHN_ORIGIN: "https://wishlist-preview.example.com",
      WEBAUTHN_RP_ID: "wishlist-preview.example.com",
    } as const;

    assert.throws(
      () => resolveWebAuthnConfig(preview),
      /disabled for Vercel Preview deployments/,
    );
    assert.equal(
      resolveWebAuthnConfig({
        ...preview,
        WEBAUTHN_PREVIEW_ENABLED: "true",
      }).rpID,
      "wishlist-preview.example.com",
    );
  });
});
