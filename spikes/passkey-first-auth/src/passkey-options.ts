import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from "@simplewebauthn/server";
import type { Base64URLString } from "@simplewebauthn/server";

export type ExistingCredential = {
  id: Base64URLString;
  transports?: string[];
};

/**
 * The WebAuthn user handle is an opaque account identifier. It is deliberately
 * unrelated to an email address or password.
 */
export async function registrationOptions(input: {
  accountHandle: Uint8Array;
  displayName: string;
  existingCredentials: ExistingCredential[];
}) {
  return generateRegistrationOptions({
    rpName: "Wishlist",
    rpID: "localhost",
    userID: Uint8Array.from(input.accountHandle),
    // `name` need not be an email; keep it opaque to avoid exposing account data.
    userName: Buffer.from(input.accountHandle).toString("base64url"),
    userDisplayName: input.displayName,
    excludeCredentials: input.existingCredentials,
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    attestationType: "none",
  });
}

/** Username-less sign-in: the authenticator selects a discoverable credential. */
export async function authenticationOptions() {
  return generateAuthenticationOptions({
    rpID: "localhost",
    userVerification: "required",
    // Omit allowCredentials so a signed-out user does not need an email/name.
  });
}
