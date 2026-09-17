import "server-only";

import { createHash } from "node:crypto";

export function hashWebAuthnChallenge(challenge: string): Buffer {
  if (challenge.length < 16 || challenge.length > 2_048) {
    throw new Error("Invalid WebAuthn challenge length");
  }

  return createHash("sha256").update(challenge, "utf8").digest();
}

export type CeremonyValidity = {
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
};

export function isWebAuthnCeremonyUsable(
  ceremony: CeremonyValidity,
  now = new Date(),
): boolean {
  return (
    ceremony.consumedAt === null &&
    ceremony.expiresAt.getTime() > now.getTime() &&
    ceremony.attemptCount < ceremony.maxAttempts
  );
}
