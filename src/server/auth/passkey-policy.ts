import "server-only";

import { timingSafeEqual } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from "@simplewebauthn/server";
import type {
  Base64URLString,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import { hashWebAuthnChallenge } from "./webauthn-ceremony";

export const CEREMONY_LIFETIME_MS = 5 * 60 * 1_000;
export const FRESH_SESSION_MAX_AGE_MS = 10 * 60 * 1_000;

export type ExistingCredential = {
  id: Base64URLString;
  transports?: string[];
};

export async function buildRegistrationOptions(input: {
  rpID: string;
  rpName: string;
  userHandle: Uint8Array;
  displayName: string;
  existingCredentials?: ExistingCredential[];
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpID: input.rpID,
    rpName: input.rpName,
    userID: Uint8Array.from(input.userHandle),
    userName: Buffer.from(input.userHandle).toString("base64url"),
    userDisplayName: input.displayName,
    excludeCredentials: input.existingCredentials ?? [],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    attestationType: "none",
    timeout: CEREMONY_LIFETIME_MS,
  });
}

export async function buildAuthenticationOptions(input: {
  rpID: string;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: input.rpID,
    userVerification: "required",
    timeout: CEREMONY_LIFETIME_MS,
    // Deliberately omit allowCredentials for discoverable, username-less login.
  });
}

export function storedChallengeMatcher(
  challengeDigest: Uint8Array,
): (candidate: string) => boolean {
  const expected = Buffer.from(challengeDigest);
  return (candidate) => {
    try {
      const actual = hashWebAuthnChallenge(candidate);
      return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  };
}

export function isFreshAuthentication(
  sessionCreatedAt: Date,
  now = new Date(),
): boolean {
  const age = now.getTime() - sessionCreatedAt.getTime();
  return age >= 0 && age <= FRESH_SESSION_MAX_AGE_MS;
}

export function canAddCredential(input: {
  sessionUserId: string;
  ceremonyUserId: string | null;
  sessionCreatedAt: Date;
  now?: Date;
}): boolean {
  return (
    input.sessionUserId === input.ceremonyUserId &&
    isFreshAuthentication(input.sessionCreatedAt, input.now)
  );
}
