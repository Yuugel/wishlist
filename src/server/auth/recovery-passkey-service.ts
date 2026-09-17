import "server-only";

import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type {
  Base64URLString,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "../db/client";
import {
  recoveryCodes,
  sessions,
  users,
  webauthnCeremonies,
  webauthnCredentials,
} from "../db/schema";
import { getWebAuthnConfig } from "./auth-config";
import { AuthError, invalidRequest } from "./auth-error";
import { recordWebAuthnCeremonyFailure } from "./ceremony-service";
import {
  buildRegistrationOptions,
  CEREMONY_LIFETIME_MS,
  storedChallengeMatcher,
} from "./passkey-policy";
import { isRecoveryCeremonyAuthorized } from "./recovery-policy";
import {
  consumeUnusableRecoveryClaims,
  insertPreparedRecoveryCode,
  prepareRecoveryCode,
  withRecoveryClaim,
} from "./recovery-service";
import {
  DEFAULT_ABSOLUTE_LIFETIME_MS,
  DEFAULT_IDLE_LIFETIME_MS,
  type IssuedSession,
} from "./session-service";
import { generateSessionToken, hashSessionToken } from "./session-token";
import { hashWebAuthnChallenge } from "./webauthn-ceremony";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function recoveryFailed(): AuthError {
  return new AuthError(
    "recovery_failed",
    401,
    "Die Wiederherstellung konnte nicht durchgeführt werden. Prüfe die Eingabe oder beginne erneut.",
  );
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function recoveryCandidate(value: unknown): string {
  const input = object(value);
  if (!input || typeof input.recoveryCode !== "string") {
    throw recoveryFailed();
  }
  return input.recoveryCode.trim();
}

export function recoveryCodeFromInput(value: unknown): string {
  return recoveryCandidate(value);
}

function registrationInput(value: unknown): {
  ceremonyId: string;
  response: RegistrationResponseJSON;
} {
  const input = object(value);
  const response = object(input?.response);
  if (
    !input ||
    typeof input.ceremonyId !== "string" ||
    !UUID.test(input.ceremonyId) ||
    !response ||
    typeof response.id !== "string" ||
    typeof response.rawId !== "string" ||
    response.type !== "public-key" ||
    !object(response.response) ||
    typeof object(response.response)?.clientDataJSON !== "string" ||
    typeof object(response.response)?.attestationObject !== "string"
  ) {
    throw invalidRequest();
  }
  return {
    ceremonyId: input.ceremonyId,
    response: input.response as RegistrationResponseJSON,
  };
}

function credentialId(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(value)) throw recoveryFailed();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.byteLength === 0 || decoded.toString("base64url") !== value) {
    throw recoveryFailed();
  }
  return decoded;
}

function deviceType(value: "singleDevice" | "multiDevice") {
  return value === "singleDevice"
    ? ("single_device" as const)
    : ("multi_device" as const);
}

export async function beginRecoveryRegistration(
  value: unknown,
  now = new Date(),
) {
  const candidate = recoveryCandidate(value);
  await consumeUnusableRecoveryClaims(now);

  const result = await withRecoveryClaim(
    candidate,
    async (tx, claim) => {
      const [user] = await tx
        .select({
          id: users.id,
          userHandle: users.webauthnUserHandle,
          displayName: users.displayName,
        })
        .from(users)
        .where(and(eq(users.id, claim.userId), eq(users.status, "active")))
        .limit(1);
      if (!user) throw recoveryFailed();

      const existing = await tx
        .select({
          credentialId: webauthnCredentials.credentialId,
          transports: webauthnCredentials.transports,
        })
        .from(webauthnCredentials)
        .where(
          and(
            eq(webauthnCredentials.userId, user.id),
            isNull(webauthnCredentials.revokedAt),
          ),
        );

      const options = await buildRegistrationOptions({
        ...getWebAuthnConfig(),
        userHandle: user.userHandle,
        displayName: user.displayName,
        existingCredentials: existing.map((entry) => ({
          id: entry.credentialId.toString("base64url") as Base64URLString,
          transports: entry.transports,
        })),
      });
      const expiresAt = new Date(now.getTime() + CEREMONY_LIFETIME_MS);
      const [ceremony] = await tx
        .insert(webauthnCeremonies)
        .values({
          type: "recovery",
          userId: user.id,
          recoveryCodeId: claim.recoveryCodeId,
          challengeDigest: hashWebAuthnChallenge(options.challenge),
          expiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: webauthnCeremonies.id });
      if (!ceremony) throw new Error("Recovery ceremony creation failed");

      return {
        ceremonyId: ceremony.id,
        options,
        claimToken: claim.claimId,
        expiresAt,
      };
    },
    now,
  );

  if (!result) throw recoveryFailed();
  return result;
}

async function markRecoveryFailure(
  ceremonyId: string,
  now: Date,
): Promise<never> {
  await recordWebAuthnCeremonyFailure(ceremonyId, now);
  await consumeUnusableRecoveryClaims(now);
  throw recoveryFailed();
}

export type CompletedRecovery = {
  session: IssuedSession;
  /** Show exactly once. Never log or persist this value. */
  recoveryCode: string;
};

export async function finishRecoveryRegistration(
  claimToken: string | undefined,
  value: unknown,
  now = new Date(),
): Promise<CompletedRecovery> {
  if (!claimToken || !UUID.test(claimToken)) throw recoveryFailed();
  const input = registrationInput(value);

  const [ceremony] = await db
    .select({
      id: webauthnCeremonies.id,
      type: webauthnCeremonies.type,
      challengeDigest: webauthnCeremonies.challengeDigest,
      userId: webauthnCeremonies.userId,
      recoveryCodeId: webauthnCeremonies.recoveryCodeId,
      expiresAt: webauthnCeremonies.expiresAt,
      consumedAt: webauthnCeremonies.consumedAt,
      attemptCount: webauthnCeremonies.attemptCount,
      maxAttempts: webauthnCeremonies.maxAttempts,
      claimId: recoveryCodes.claimId,
      recoveryUserId: recoveryCodes.userId,
      recoveryStatus: recoveryCodes.status,
      userStatus: users.status,
    })
    .from(webauthnCeremonies)
    .innerJoin(
      recoveryCodes,
      eq(recoveryCodes.id, webauthnCeremonies.recoveryCodeId),
    )
    .innerJoin(users, eq(users.id, webauthnCeremonies.userId))
    .where(eq(webauthnCeremonies.id, input.ceremonyId))
    .limit(1);

  if (
    !ceremony ||
    !isRecoveryCeremonyAuthorized({ ceremony, claimToken, now })
  ) {
    await consumeUnusableRecoveryClaims(now);
    throw recoveryFailed();
  }

  let verification;
  try {
    const config = getWebAuthnConfig();
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: storedChallengeMatcher(ceremony.challengeDigest),
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
  } catch {
    return markRecoveryFailure(ceremony.id, now);
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    return markRecoveryFailure(ceremony.id, now);
  }

  const info = verification.registrationInfo;
  const newCredentialId = credentialId(info.credential.id);
  const replacement = prepareRecoveryCode();
  const sessionToken = generateSessionToken();
  const idleExpiresAt = new Date(now.getTime() + DEFAULT_IDLE_LIFETIME_MS);
  const absoluteExpiresAt = new Date(
    now.getTime() + DEFAULT_ABSOLUTE_LIFETIME_MS,
  );

  try {
    const sessionId = await db.transaction(async (tx) => {
      const [consumedCeremony] = await tx
        .update(webauthnCeremonies)
        .set({ consumedAt: now, updatedAt: now })
        .where(
          and(
            eq(webauthnCeremonies.id, ceremony.id),
            eq(webauthnCeremonies.type, "recovery"),
            eq(webauthnCeremonies.userId, ceremony.userId!),
            eq(
              webauthnCeremonies.recoveryCodeId,
              ceremony.recoveryCodeId!,
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
      if (!consumedCeremony) throw recoveryFailed();

      const [consumedCode] = await tx
        .update(recoveryCodes)
        .set({ status: "consumed", consumedAt: now, updatedAt: now })
        .where(
          and(
            eq(recoveryCodes.id, ceremony.recoveryCodeId!),
            eq(recoveryCodes.userId, ceremony.userId!),
            eq(recoveryCodes.claimId, claimToken),
            eq(recoveryCodes.status, "claimed"),
          ),
        )
        .returning({ id: recoveryCodes.id });
      if (!consumedCode) throw recoveryFailed();

      await tx
        .update(webauthnCredentials)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(webauthnCredentials.userId, ceremony.userId!),
            isNull(webauthnCredentials.revokedAt),
          ),
        );

      await tx.insert(webauthnCredentials).values({
        userId: ceremony.userId!,
        credentialId: newCredentialId,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        transports: input.response.response.transports ?? [],
        deviceType: deviceType(info.credentialDeviceType),
        backedUp: info.credentialBackedUp,
        aaguid: info.aaguid,
        createdAt: now,
        updatedAt: now,
      });

      await tx
        .update(sessions)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(sessions.userId, ceremony.userId!),
            isNull(sessions.revokedAt),
          ),
        );

      await insertPreparedRecoveryCode(
        tx,
        ceremony.userId!,
        replacement,
        now,
      );

      const [createdSession] = await tx
        .insert(sessions)
        .values({
          userId: ceremony.userId!,
          tokenDigest: hashSessionToken(sessionToken),
          lastSeenAt: now,
          idleExpiresAt,
          absoluteExpiresAt,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: sessions.id });
      if (!createdSession) throw new Error("Recovery session creation failed");
      return createdSession.id;
    });

    return {
      session: {
        token: sessionToken,
        sessionId,
        idleExpiresAt,
        absoluteExpiresAt,
      },
      recoveryCode: replacement.displayCode,
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      "recovery_completion_failed",
      409,
      "Die Wiederherstellung konnte nicht abgeschlossen werden. Bitte beginne erneut.",
    );
  }
}
