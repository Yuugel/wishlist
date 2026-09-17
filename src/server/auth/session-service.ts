import "server-only";

import { and, eq, exists, gt, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { sessions, users } from "../db/schema";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionToken,
} from "./session-token";

export const DEFAULT_IDLE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;

export type IssuedSession = {
  /** Return only to the secure cookie layer. Never log or persist this value. */
  token: string;
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
};

export type ResolvedSession = {
  sessionId: string;
  userId: string;
  createdAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
};

export async function createSession(input: {
  userId: string;
  now?: Date;
  idleLifetimeMs?: number;
  absoluteLifetimeMs?: number;
}): Promise<IssuedSession> {
  const now = input.now ?? new Date();
  const idleLifetimeMs = input.idleLifetimeMs ?? DEFAULT_IDLE_LIFETIME_MS;
  const absoluteLifetimeMs =
    input.absoluteLifetimeMs ?? DEFAULT_ABSOLUTE_LIFETIME_MS;

  if (idleLifetimeMs <= 0 || absoluteLifetimeMs < idleLifetimeMs) {
    throw new Error("Invalid session lifetime configuration");
  }

  const token = generateSessionToken();
  const idleExpiresAt = new Date(now.getTime() + idleLifetimeMs);
  const absoluteExpiresAt = new Date(now.getTime() + absoluteLifetimeMs);
  const [created] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenDigest: hashSessionToken(token),
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: sessions.id });

  if (!created) throw new Error("Session creation failed");

  return { token, sessionId: created.id, idleExpiresAt, absoluteExpiresAt };
}

/**
 * Resolves and refreshes an unexpired session. The conditional UPDATE makes
 * expiry/revocation checks authoritative in PostgreSQL rather than in UI code.
 */
export async function resolveSession(
  token: string,
  now = new Date(),
): Promise<ResolvedSession | null> {
  if (!isSessionToken(token)) return null;

  const tokenDigest = hashSessionToken(token);
  const [current] = await db
    .select({ absoluteExpiresAt: sessions.absoluteExpiresAt })
    .from(sessions)
    .where(eq(sessions.tokenDigest, tokenDigest))
    .limit(1);

  if (!current) return null;

  const refreshedIdleExpiry = new Date(
    Math.min(
      now.getTime() + DEFAULT_IDLE_LIFETIME_MS,
      current.absoluteExpiresAt.getTime(),
    ),
  );

  const [resolved] = await db
    .update(sessions)
    .set({
      lastSeenAt: now,
      idleExpiresAt: refreshedIdleExpiry,
      updatedAt: now,
    })
    .where(
      and(
        eq(sessions.tokenDigest, tokenDigest),
        isNull(sessions.revokedAt),
        gt(sessions.idleExpiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
        exists(
          db
            .select({ id: users.id })
            .from(users)
            .where(
              and(eq(users.id, sessions.userId), eq(users.status, "active")),
            ),
        ),
      ),
    )
    .returning({
      sessionId: sessions.id,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      idleExpiresAt: sessions.idleExpiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
    });

  return resolved ?? null;
}

/** Creates a new session and revokes the browser's previous token atomically. */
export async function rotateSession(input: {
  userId: string;
  previousToken?: string;
  now?: Date;
}): Promise<IssuedSession> {
  const now = input.now ?? new Date();
  const token = generateSessionToken();
  const idleExpiresAt = new Date(now.getTime() + DEFAULT_IDLE_LIFETIME_MS);
  const absoluteExpiresAt = new Date(
    now.getTime() + DEFAULT_ABSOLUTE_LIFETIME_MS,
  );

  return db.transaction(async (tx) => {
    if (input.previousToken && isSessionToken(input.previousToken)) {
      await tx
        .update(sessions)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(sessions.tokenDigest, hashSessionToken(input.previousToken)),
            isNull(sessions.revokedAt),
          ),
        );
    }

    const [created] = await tx
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenDigest: hashSessionToken(token),
        lastSeenAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: sessions.id });

    if (!created) throw new Error("Session rotation failed");
    return { token, sessionId: created.id, idleExpiresAt, absoluteExpiresAt };
  });
}

export async function revokeSession(
  token: string,
  now = new Date(),
): Promise<boolean> {
  if (!isSessionToken(token)) return false;

  const [revoked] = await db
    .update(sessions)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(sessions.tokenDigest, hashSessionToken(token)),
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });

  return revoked !== undefined;
}

export async function revokeAllUserSessions(
  userId: string,
  now = new Date(),
): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  return revoked.length;
}
