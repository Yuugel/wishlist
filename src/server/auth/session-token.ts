import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TOKEN_PREFIX = "ws1_";
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^ws1_[A-Za-z0-9_-]{43}$/;

/** Generates a 256-bit bearer token. The returned value must never be logged or persisted. */
export function generateSessionToken(): string {
  return `${SESSION_TOKEN_PREFIX}${randomBytes(SESSION_TOKEN_BYTES).toString("base64url")}`;
}

export function isSessionToken(value: string): boolean {
  if (!SESSION_TOKEN_PATTERN.test(value)) return false;

  return (
    Buffer.from(value.slice(SESSION_TOKEN_PREFIX.length), "base64url")
      .byteLength === SESSION_TOKEN_BYTES
  );
}

/** Produces the only representation of a session token that may be persisted. */
export function hashSessionToken(token: string): Buffer {
  if (!isSessionToken(token)) {
    throw new Error("Invalid session token format");
  }

  return createHash("sha256").update(token, "ascii").digest();
}

export function verifySessionTokenDigest(
  candidate: string,
  persistedDigest: Uint8Array,
): boolean {
  if (!isSessionToken(candidate)) return false;

  const actual = hashSessionToken(candidate);
  const expected = Buffer.from(persistedDigest);
  return (
    actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
  );
}

export type SessionValidity = {
  revokedAt: Date | null;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
};

export function isSessionUsable(
  session: SessionValidity,
  now = new Date(),
): boolean {
  return (
    session.revokedAt === null &&
    session.idleExpiresAt.getTime() > now.getTime() &&
    session.absoluteExpiresAt.getTime() > now.getTime()
  );
}
