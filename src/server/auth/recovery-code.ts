import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const CODE_VERSION = "wl1";
const SELECTOR_BYTES = 16;
const SECRET_BYTES = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export type ParsedRecoveryCode = {
  selector: string;
  secret: string;
};

export type GeneratedRecoveryCode = {
  /** Show exactly once. Never log or persist this value. */
  displayCode: string;
  selector: string;
  digest: Buffer;
  pepperKeyVersion: number;
};

function assertPepper(pepper: Uint8Array): void {
  if (pepper.byteLength < 32) {
    throw new Error("Recovery pepper must contain at least 256 bits");
  }
}

export function parseRecoveryCode(candidate: string): ParsedRecoveryCode | null {
  const match = /^wl1_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(candidate);
  if (!match) return null;

  const [, selector, secret] = match;
  if (
    selector.length !== 22 ||
    secret.length !== 43 ||
    !BASE64URL.test(selector) ||
    !BASE64URL.test(secret) ||
    Buffer.from(selector, "base64url").byteLength !== SELECTOR_BYTES ||
    Buffer.from(secret, "base64url").byteLength !== SECRET_BYTES
  ) {
    return null;
  }

  return { selector, secret };
}

export function calculateRecoveryCodeDigest(input: {
  selector: string;
  secret: string;
  pepper: Uint8Array;
}): Buffer {
  assertPepper(input.pepper);

  return createHmac("sha256", input.pepper)
    .update("wishlist-recovery\0", "utf8")
    .update(input.selector, "ascii")
    .update("\0", "ascii")
    .update(input.secret, "ascii")
    .digest();
}

export function generateRecoveryCode(input: {
  pepper: Uint8Array;
  pepperKeyVersion: number;
}): GeneratedRecoveryCode {
  assertPepper(input.pepper);
  if (!Number.isSafeInteger(input.pepperKeyVersion) || input.pepperKeyVersion < 1) {
    throw new Error("Recovery pepper key version must be a positive integer");
  }

  const selector = randomBytes(SELECTOR_BYTES).toString("base64url");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");

  return {
    displayCode: `${CODE_VERSION}_${selector}.${secret}`,
    selector,
    digest: calculateRecoveryCodeDigest({
      selector,
      secret,
      pepper: input.pepper,
    }),
    pepperKeyVersion: input.pepperKeyVersion,
  };
}

export function verifyRecoveryCode(input: {
  candidate: string;
  selector: string;
  persistedDigest: Uint8Array;
  pepper: Uint8Array;
}): boolean {
  const parsed = parseRecoveryCode(input.candidate);
  if (!parsed || parsed.selector !== input.selector) return false;

  const expected = Buffer.from(input.persistedDigest);
  const actual = calculateRecoveryCodeDigest({ ...parsed, pepper: input.pepper });

  return (
    expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual)
  );
}
