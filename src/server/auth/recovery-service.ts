import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { recoveryCodes } from "../db/schema";
import {
  generateRecoveryCode,
  parseRecoveryCode,
  verifyRecoveryCode,
} from "./recovery-code";
import {
  getActiveRecoveryPepper,
  getRecoveryPepper,
} from "./recovery-peppers";

export type IssuedRecoveryCode = {
  /** Display once over a protected channel. Never log or persist this value. */
  displayCode: string;
  recoveryCodeId: string;
};

export type RecoveryClaim = {
  recoveryCodeId: string;
  userId: string;
  claimId: string;
};

export async function createRecoveryCode(
  userId: string,
  now = new Date(),
): Promise<IssuedRecoveryCode> {
  const { version, pepper } = getActiveRecoveryPepper();
  const generated = generateRecoveryCode({
    pepper,
    pepperKeyVersion: version,
  });
  const [created] = await db
    .insert(recoveryCodes)
    .values({
      userId,
      selector: generated.selector,
      digest: generated.digest,
      pepperKeyVersion: generated.pepperKeyVersion,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: recoveryCodes.id });

  if (!created) throw new Error("Recovery code creation failed");
  return { displayCode: generated.displayCode, recoveryCodeId: created.id };
}

/** Revokes the current active code and creates its replacement atomically. */
export async function rotateRecoveryCode(
  userId: string,
  now = new Date(),
): Promise<IssuedRecoveryCode> {
  const { version, pepper } = getActiveRecoveryPepper();
  const generated = generateRecoveryCode({
    pepper,
    pepperKeyVersion: version,
  });

  return db.transaction(async (tx) => {
    await tx
      .update(recoveryCodes)
      .set({ status: "revoked", revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(recoveryCodes.userId, userId),
          eq(recoveryCodes.status, "active"),
        ),
      );

    const [created] = await tx
      .insert(recoveryCodes)
      .values({
        userId,
        selector: generated.selector,
        digest: generated.digest,
        pepperKeyVersion: generated.pepperKeyVersion,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: recoveryCodes.id });

    if (!created) throw new Error("Recovery code rotation failed");
    return { displayCode: generated.displayCode, recoveryCodeId: created.id };
  });
}

/**
 * Verifies the secret and performs active -> claimed as one conditional UPDATE.
 * A concurrent or repeated claimant cannot receive a second successful claim.
 */
export async function claimRecoveryCode(
  candidate: string,
  now = new Date(),
): Promise<RecoveryClaim | null> {
  const parsed = parseRecoveryCode(candidate);
  if (!parsed) return null;

  const [stored] = await db
    .select({
      id: recoveryCodes.id,
      userId: recoveryCodes.userId,
      selector: recoveryCodes.selector,
      digest: recoveryCodes.digest,
      pepperKeyVersion: recoveryCodes.pepperKeyVersion,
    })
    .from(recoveryCodes)
    .where(eq(recoveryCodes.selector, parsed.selector))
    .limit(1);

  if (!stored) return null;

  const pepper = getRecoveryPepper(stored.pepperKeyVersion);
  if (
    !verifyRecoveryCode({
      candidate,
      selector: stored.selector,
      persistedDigest: stored.digest,
      pepper,
    })
  ) {
    return null;
  }

  const claimId = randomUUID();
  const [claimed] = await db
    .update(recoveryCodes)
    .set({ status: "claimed", claimId, claimedAt: now, updatedAt: now })
    .where(
      and(
        eq(recoveryCodes.id, stored.id),
        eq(recoveryCodes.status, "active"),
      ),
    )
    .returning({
      recoveryCodeId: recoveryCodes.id,
      userId: recoveryCodes.userId,
    });

  return claimed ? { ...claimed, claimId } : null;
}

/** Atomically permits only the matching claimed code to become consumed. */
export async function consumeClaimedRecoveryCode(
  recoveryCodeId: string,
  claimId: string,
  now = new Date(),
): Promise<boolean> {
  const [consumed] = await db
    .update(recoveryCodes)
    .set({ status: "consumed", consumedAt: now, updatedAt: now })
    .where(
      and(
        eq(recoveryCodes.id, recoveryCodeId),
        eq(recoveryCodes.claimId, claimId),
        eq(recoveryCodes.status, "claimed"),
      ),
    )
    .returning({ id: recoveryCodes.id });

  return consumed !== undefined;
}

export async function revokeRecoveryCode(
  recoveryCodeId: string,
  now = new Date(),
): Promise<boolean> {
  const [revoked] = await db
    .update(recoveryCodes)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(recoveryCodes.id, recoveryCodeId),
        inArray(recoveryCodes.status, ["active", "claimed"]),
      ),
    )
    .returning({ id: recoveryCodes.id });

  return revoked !== undefined;
}
