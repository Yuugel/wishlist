import "server-only";

import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  webauthnCeremonies,
  webauthnCeremonyType,
} from "../db/schema";
import { hashWebAuthnChallenge } from "./webauthn-ceremony";

type CeremonyType = (typeof webauthnCeremonyType.enumValues)[number];

/**
 * Atomically consumes one matching, live ceremony. Expired, exhausted, or
 * previously consumed challenges cannot be reused.
 */
export async function consumeWebAuthnCeremony(input: {
  ceremonyId: string;
  type: CeremonyType;
  challenge: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const [consumed] = await db
    .update(webauthnCeremonies)
    .set({ consumedAt: now, updatedAt: now })
    .where(
      and(
        eq(webauthnCeremonies.id, input.ceremonyId),
        eq(webauthnCeremonies.type, input.type),
        eq(
          webauthnCeremonies.challengeDigest,
          hashWebAuthnChallenge(input.challenge),
        ),
        isNull(webauthnCeremonies.consumedAt),
        gt(webauthnCeremonies.expiresAt, now),
        lt(
          webauthnCeremonies.attemptCount,
          webauthnCeremonies.maxAttempts,
        ),
      ),
    )
    .returning({ id: webauthnCeremonies.id });

  return consumed !== undefined;
}

/** Counts a failed verification without allowing the counter to exceed its cap. */
export async function recordWebAuthnCeremonyFailure(
  ceremonyId: string,
  now = new Date(),
): Promise<boolean> {
  const [updated] = await db
    .update(webauthnCeremonies)
    .set({
      attemptCount: sql`${webauthnCeremonies.attemptCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(webauthnCeremonies.id, ceremonyId),
        isNull(webauthnCeremonies.consumedAt),
        gt(webauthnCeremonies.expiresAt, now),
        lt(
          webauthnCeremonies.attemptCount,
          webauthnCeremonies.maxAttempts,
        ),
      ),
    )
    .returning({ id: webauthnCeremonies.id });

  return updated !== undefined;
}
