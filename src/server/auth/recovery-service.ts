import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { recoveryCodes } from "../db/schema";
import {
  calculateRecoveryCodeDigest,
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

export type RecoveryTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

function performDummyVerification(candidate: string): void {
  const parsed = parseRecoveryCode(candidate);
  const { pepper } = getActiveRecoveryPepper();
  calculateRecoveryCodeDigest({
    selector: parsed?.selector ?? "AAAAAAAAAAAAAAAAAAAAAA",
    secret: parsed?.secret ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    pepper,
  });
}

export function prepareRecoveryCode(): {
  displayCode: string;
  selector: string;
  digest: Buffer;
  pepperKeyVersion: number;
} {
  const { version, pepper } = getActiveRecoveryPepper();
  return generateRecoveryCode({ pepper, pepperKeyVersion: version });
}

export async function insertPreparedRecoveryCode(
  tx: RecoveryTransaction,
  userId: string,
  generated: ReturnType<typeof prepareRecoveryCode>,
  now = new Date(),
): Promise<string> {
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

  if (!created) throw new Error("Recovery code creation failed");
  return created.id;
}

export async function createRecoveryCode(
  userId: string,
  now = new Date(),
): Promise<IssuedRecoveryCode> {
  const generated = prepareRecoveryCode();
  const recoveryCodeId = await db.transaction((tx) =>
    insertPreparedRecoveryCode(tx, userId, generated, now),
  );
  return { displayCode: generated.displayCode, recoveryCodeId };
}

/** Revokes the current active code and creates its replacement atomically. */
export async function rotateRecoveryCode(
  userId: string,
  now = new Date(),
): Promise<IssuedRecoveryCode> {
  const generated = prepareRecoveryCode();

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

    const recoveryCodeId = await insertPreparedRecoveryCode(
      tx,
      userId,
      generated,
      now,
    );
    return { displayCode: generated.displayCode, recoveryCodeId };
  });
}

/**
 * Verifies the candidate, atomically performs active -> claimed, and runs the
 * supplied operation in that same transaction. If the operation fails, the
 * claim rolls back, avoiding a code being stranded by an internal error.
 */
export async function withRecoveryClaim<T>(
  candidate: string,
  operation: (
    tx: RecoveryTransaction,
    claim: RecoveryClaim,
  ) => Promise<T>,
  now = new Date(),
): Promise<T | null> {
  const parsed = parseRecoveryCode(candidate);
  if (!parsed) {
    performDummyVerification(candidate);
    return null;
  }

  return db.transaction(async (tx) => {
    const [stored] = await tx
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

    if (!stored) {
      performDummyVerification(candidate);
      return null;
    }

    let pepper: Buffer;
    try {
      pepper = getRecoveryPepper(stored.pepperKeyVersion);
    } catch {
      // Missing historical key material must fail closed without turning a
      // selector hit into a distinguishable public response.
      performDummyVerification(candidate);
      return null;
    }
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
    const [claimed] = await tx
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

    if (!claimed) return null;
    return operation(tx, { ...claimed, claimId });
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
  return withRecoveryClaim(candidate, async (_tx, claim) => claim, now);
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

/**
 * Maintenance hook for request-time cleanup and a future scheduler. Claimed
 * codes whose one recovery ceremony expired or exhausted its attempts become
 * consumed, as required by ADR 0001; they never return to active.
 */
export async function consumeUnusableRecoveryClaims(
  now = new Date(),
): Promise<void> {
  await db.execute(sql`
    update recovery_codes as recovery
       set status = 'consumed', consumed_at = ${now}, updated_at = ${now}
     where recovery.status = 'claimed'
       and exists (
         select 1
           from webauthn_ceremonies as ceremony
          where ceremony.recovery_code_id = recovery.id
            and ceremony.type = 'recovery'
            and ceremony.consumed_at is null
            and (
              ceremony.expires_at <= ${now}
              or ceremony.attempt_count >= ceremony.max_attempts
            )
       )
  `);
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
