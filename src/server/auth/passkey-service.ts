import "server-only";

import { randomBytes } from "node:crypto";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  Base64URLString,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "../db/client";
import { users, webauthnCeremonies, webauthnCredentials } from "../db/schema";
import { getWebAuthnConfig } from "./auth-config";
import { AuthError, authenticationFailed, invalidRequest } from "./auth-error";
import { recordWebAuthnCeremonyFailure } from "./ceremony-service";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  canAddCredential,
  CEREMONY_LIFETIME_MS,
  isFreshAuthentication,
  storedChallengeMatcher,
} from "./passkey-policy";
import {
  insertPreparedRecoveryCode,
  prepareRecoveryCode,
} from "./recovery-service";
import type { ResolvedSession } from "./session-service";
import { hashWebAuthnChallenge, isWebAuthnCeremonyUsable } from "./webauthn-ceremony";

type CeremonyType = "signup" | "authentication" | "add_credential";

type CeremonyRecord = {
  id: string;
  type: CeremonyType | "recovery";
  challengeDigest: Buffer;
  userId: string | null;
  pendingUserHandle: Buffer | null;
  pendingDisplayName: string | null;
  pendingEmail: string | null;
  pendingEmailNormalized: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function registrationResponse(value: unknown): RegistrationResponseJSON {
  const input = object(value);
  const response = object(input?.response);
  if (
    !input ||
    typeof input.id !== "string" ||
    typeof input.rawId !== "string" ||
    input.type !== "public-key" ||
    !response ||
    typeof response.clientDataJSON !== "string" ||
    typeof response.attestationObject !== "string"
  ) {
    throw invalidRequest();
  }
  return value as RegistrationResponseJSON;
}

function authenticationResponse(value: unknown): AuthenticationResponseJSON {
  const input = object(value);
  const response = object(input?.response);
  if (
    !input ||
    typeof input.id !== "string" ||
    typeof input.rawId !== "string" ||
    input.type !== "public-key" ||
    !response ||
    typeof response.clientDataJSON !== "string" ||
    typeof response.authenticatorData !== "string" ||
    typeof response.signature !== "string"
  ) {
    throw invalidRequest();
  }
  return value as AuthenticationResponseJSON;
}

function parseCeremonyInput(value: unknown): {
  ceremonyId: string;
  response: unknown;
} {
  const input = object(value);
  if (
    !input ||
    typeof input.ceremonyId !== "string" ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.ceremonyId) ||
    !("response" in input)
  ) {
    throw invalidRequest();
  }
  return { ceremonyId: input.ceremonyId, response: input.response };
}

function parseCredentialID(id: string): Buffer {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(id)) throw authenticationFailed();
  const decoded = Buffer.from(id, "base64url");
  if (decoded.byteLength === 0 || decoded.toString("base64url") !== id) {
    throw authenticationFailed();
  }
  return decoded;
}

function normalizeSignupInput(value: unknown): {
  displayName: string;
  email: string | null;
  emailNormalized: string | null;
} {
  const input = object(value);
  const displayName = typeof input?.displayName === "string"
    ? input.displayName.trim()
    : "";
  if (displayName.length < 1 || displayName.length > 200) {
    throw invalidRequest();
  }

  if (input?.email === undefined || input.email === null || input.email === "") {
    return { displayName, email: null, emailNormalized: null };
  }
  if (typeof input.email !== "string") throw invalidRequest();
  const email = input.email.trim();
  if (
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw invalidRequest();
  }
  return { displayName, email, emailNormalized: email.toLowerCase() };
}

async function loadCeremony(
  ceremonyId: string,
  expectedType: CeremonyType,
  now: Date,
): Promise<CeremonyRecord> {
  const [ceremony] = await db
    .select({
      id: webauthnCeremonies.id,
      type: webauthnCeremonies.type,
      challengeDigest: webauthnCeremonies.challengeDigest,
      userId: webauthnCeremonies.userId,
      pendingUserHandle: webauthnCeremonies.pendingUserHandle,
      pendingDisplayName: webauthnCeremonies.pendingDisplayName,
      pendingEmail: webauthnCeremonies.pendingEmail,
      pendingEmailNormalized: webauthnCeremonies.pendingEmailNormalized,
      expiresAt: webauthnCeremonies.expiresAt,
      consumedAt: webauthnCeremonies.consumedAt,
      attemptCount: webauthnCeremonies.attemptCount,
      maxAttempts: webauthnCeremonies.maxAttempts,
    })
    .from(webauthnCeremonies)
    .where(eq(webauthnCeremonies.id, ceremonyId))
    .limit(1);

  if (
    !ceremony ||
    ceremony.type !== expectedType ||
    !isWebAuthnCeremonyUsable(ceremony, now)
  ) {
    throw authenticationFailed();
  }
  return ceremony;
}

async function markVerificationFailure(ceremonyId: string): Promise<never> {
  await recordWebAuthnCeremonyFailure(ceremonyId);
  throw authenticationFailed();
}

function deviceType(value: "singleDevice" | "multiDevice") {
  return value === "singleDevice" ? "single_device" as const : "multi_device" as const;
}

function ceremonyExpiry(now: Date): Date {
  return new Date(now.getTime() + CEREMONY_LIFETIME_MS);
}

export async function beginSignup(value: unknown, now = new Date()) {
  const profile = normalizeSignupInput(value);
  const config = getWebAuthnConfig();
  const userHandle = randomBytes(32);
  const options = await buildRegistrationOptions({
    ...config,
    userHandle,
    displayName: profile.displayName,
  });
  const [ceremony] = await db
    .insert(webauthnCeremonies)
    .values({
      type: "signup",
      challengeDigest: hashWebAuthnChallenge(options.challenge),
      pendingUserHandle: userHandle,
      pendingDisplayName: profile.displayName,
      pendingEmail: profile.email,
      pendingEmailNormalized: profile.emailNormalized,
      expiresAt: ceremonyExpiry(now),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: webauthnCeremonies.id });

  if (!ceremony) throw new Error("Ceremony creation failed");
  return { ceremonyId: ceremony.id, options };
}

export async function finishSignup(value: unknown, now = new Date()) {
  const input = parseCeremonyInput(value);
  const response = registrationResponse(input.response);
  const ceremony = await loadCeremony(input.ceremonyId, "signup", now);
  if (!ceremony.pendingUserHandle || !ceremony.pendingDisplayName) {
    throw authenticationFailed();
  }

  let verification;
  try {
    const config = getWebAuthnConfig();
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: storedChallengeMatcher(ceremony.challengeDigest),
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
  } catch {
    return markVerificationFailure(ceremony.id);
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    return markVerificationFailure(ceremony.id);
  }

  const info = verification.registrationInfo;
  const credentialID = parseCredentialID(info.credential.id);
  const recoveryCode = prepareRecoveryCode();

  try {
    return await db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(webauthnCeremonies)
        .set({ consumedAt: now, updatedAt: now })
        .where(
          and(
            eq(webauthnCeremonies.id, ceremony.id),
            eq(webauthnCeremonies.type, "signup"),
            isNull(webauthnCeremonies.consumedAt),
            gt(webauthnCeremonies.expiresAt, now),
            lt(webauthnCeremonies.attemptCount, webauthnCeremonies.maxAttempts),
          ),
        )
        .returning({ id: webauthnCeremonies.id });
      if (!consumed) throw authenticationFailed();

      const [user] = await tx
        .insert(users)
        .values({
          webauthnUserHandle: ceremony.pendingUserHandle!,
          displayName: ceremony.pendingDisplayName!,
          email: ceremony.pendingEmail,
          emailNormalized: ceremony.pendingEmailNormalized,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: users.id });
      if (!user) throw new Error("Account creation failed");

      await tx.insert(webauthnCredentials).values({
        userId: user.id,
        credentialId: credentialID,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        transports: response.response.transports ?? [],
        deviceType: deviceType(info.credentialDeviceType),
        backedUp: info.credentialBackedUp,
        aaguid: info.aaguid,
        createdAt: now,
        updatedAt: now,
      });
      await insertPreparedRecoveryCode(tx, user.id, recoveryCode, now);
      return {
        userId: user.id,
        recoveryCode: recoveryCode.displayCode,
      };
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      "signup_failed",
      409,
      "Das Konto konnte nicht erstellt werden. Bitte beginne erneut.",
    );
  }
}

export async function beginAuthentication(now = new Date()) {
  const config = getWebAuthnConfig();
  const options = await buildAuthenticationOptions(config);
  const [ceremony] = await db
    .insert(webauthnCeremonies)
    .values({
      type: "authentication",
      challengeDigest: hashWebAuthnChallenge(options.challenge),
      expiresAt: ceremonyExpiry(now),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: webauthnCeremonies.id });
  if (!ceremony) throw new Error("Ceremony creation failed");
  return { ceremonyId: ceremony.id, options };
}

export async function finishAuthentication(value: unknown, now = new Date()) {
  const input = parseCeremonyInput(value);
  const response = authenticationResponse(input.response);
  const ceremony = await loadCeremony(input.ceremonyId, "authentication", now);
  const credentialID = parseCredentialID(response.id);

  const [stored] = await db
    .select({
      id: webauthnCredentials.id,
      userId: webauthnCredentials.userId,
      credentialId: webauthnCredentials.credentialId,
      publicKey: webauthnCredentials.publicKey,
      counter: webauthnCredentials.counter,
      transports: webauthnCredentials.transports,
      userHandle: users.webauthnUserHandle,
    })
    .from(webauthnCredentials)
    .innerJoin(users, eq(users.id, webauthnCredentials.userId))
    .where(
      and(
        eq(webauthnCredentials.credentialId, credentialID),
        isNull(webauthnCredentials.revokedAt),
        eq(users.status, "active"),
      ),
    )
    .limit(1);

  if (
    !stored ||
    response.response.userHandle !== stored.userHandle.toString("base64url")
  ) {
    return markVerificationFailure(ceremony.id);
  }

  let verification;
  try {
    const config = getWebAuthnConfig();
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: storedChallengeMatcher(ceremony.challengeDigest),
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      credential: {
        id: response.id as Base64URLString,
        publicKey: Uint8Array.from(stored.publicKey),
        counter: Number(stored.counter),
        transports: stored.transports,
      },
      requireUserVerification: true,
    });
  } catch {
    return markVerificationFailure(ceremony.id);
  }
  if (!verification.verified || !verification.authenticationInfo.userVerified) {
    return markVerificationFailure(ceremony.id);
  }

  return db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(webauthnCeremonies)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(webauthnCeremonies.id, ceremony.id),
          eq(webauthnCeremonies.type, "authentication"),
          isNull(webauthnCeremonies.consumedAt),
          gt(webauthnCeremonies.expiresAt, now),
          lt(webauthnCeremonies.attemptCount, webauthnCeremonies.maxAttempts),
        ),
      )
      .returning({ id: webauthnCeremonies.id });
    if (!consumed) throw authenticationFailed();

    const authInfo = verification.authenticationInfo;
    const [updated] = await tx
      .update(webauthnCredentials)
      .set({
        counter: BigInt(authInfo.newCounter),
        deviceType: deviceType(authInfo.credentialDeviceType),
        backedUp: authInfo.credentialBackedUp,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(webauthnCredentials.id, stored.id),
          eq(webauthnCredentials.counter, stored.counter),
          isNull(webauthnCredentials.revokedAt),
        ),
      )
      .returning({ id: webauthnCredentials.id });
    if (!updated) throw authenticationFailed();
    return { userId: stored.userId };
  });
}

export async function beginAdditionalCredential(
  session: ResolvedSession,
  now = new Date(),
) {
  if (!isFreshAuthentication(session.createdAt, now)) {
    throw new AuthError(
      "reauthentication_required",
      403,
      "Bitte melde dich erneut an, bevor du einen Passkey hinzufügst.",
    );
  }

  const [user] = await db
    .select({
      id: users.id,
      userHandle: users.webauthnUserHandle,
      displayName: users.displayName,
    })
    .from(users)
    .where(and(eq(users.id, session.userId), eq(users.status, "active")))
    .limit(1);
  if (!user) throw authenticationFailed();

  const credentials = await db
    .select({
      credentialId: webauthnCredentials.credentialId,
      transports: webauthnCredentials.transports,
    })
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.userId, session.userId),
        isNull(webauthnCredentials.revokedAt),
      ),
    );
  const config = getWebAuthnConfig();
  const options = await buildRegistrationOptions({
    ...config,
    userHandle: user.userHandle,
    displayName: user.displayName,
    existingCredentials: credentials.map((credential) => ({
      id: credential.credentialId.toString("base64url") as Base64URLString,
      transports: credential.transports,
    })),
  });

  const [ceremony] = await db
    .insert(webauthnCeremonies)
    .values({
      type: "add_credential",
      userId: session.userId,
      challengeDigest: hashWebAuthnChallenge(options.challenge),
      expiresAt: ceremonyExpiry(now),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: webauthnCeremonies.id });
  if (!ceremony) throw new Error("Ceremony creation failed");
  return { ceremonyId: ceremony.id, options };
}

export async function finishAdditionalCredential(
  session: ResolvedSession,
  value: unknown,
  now = new Date(),
) {
  const input = parseCeremonyInput(value);
  const response = registrationResponse(input.response);
  const ceremony = await loadCeremony(input.ceremonyId, "add_credential", now);
  if (
    !canAddCredential({
      sessionUserId: session.userId,
      ceremonyUserId: ceremony.userId,
      sessionCreatedAt: session.createdAt,
      now,
    })
  ) {
    throw new AuthError(
      "reauthentication_required",
      403,
      "Bitte melde dich erneut an, bevor du einen Passkey hinzufügst.",
    );
  }

  let verification;
  try {
    const config = getWebAuthnConfig();
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: storedChallengeMatcher(ceremony.challengeDigest),
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
  } catch {
    return markVerificationFailure(ceremony.id);
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    return markVerificationFailure(ceremony.id);
  }

  const info = verification.registrationInfo;
  const credentialID = parseCredentialID(info.credential.id);
  try {
    await db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(webauthnCeremonies)
        .set({ consumedAt: now, updatedAt: now })
        .where(
          and(
            eq(webauthnCeremonies.id, ceremony.id),
            eq(webauthnCeremonies.type, "add_credential"),
            eq(webauthnCeremonies.userId, session.userId),
            isNull(webauthnCeremonies.consumedAt),
            gt(webauthnCeremonies.expiresAt, now),
            lt(webauthnCeremonies.attemptCount, webauthnCeremonies.maxAttempts),
          ),
        )
        .returning({ id: webauthnCeremonies.id });
      if (!consumed) throw authenticationFailed();

      await tx.insert(webauthnCredentials).values({
        userId: session.userId,
        credentialId: credentialID,
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter),
        transports: response.response.transports ?? [],
        deviceType: deviceType(info.credentialDeviceType),
        backedUp: info.credentialBackedUp,
        aaguid: info.aaguid,
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(
      "credential_add_failed",
      409,
      "Der Passkey konnte nicht hinzugefügt werden. Bitte beginne erneut.",
    );
  }
}
